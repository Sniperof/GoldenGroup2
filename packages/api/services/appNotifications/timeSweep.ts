// ============================================================
// services/appNotifications/timeSweep.ts
// ============================================================
// DEC-019 Phase 6 — the time-based family (D-N4).
//
// Nothing here reacts to a change; these notifications exist because a DATE
// arrived. So the source is a DERIVED QUERY over the live tables, never a queue
// of pre-scheduled rows: a cancelled visit simply stops matching the query,
// whereas a pre-scheduled row would still be sitting there waiting to announce
// a visit that is no longer happening.
//
// Re-running the sweep is harmless. Every type here carries dedup coordinates,
// and the partial unique index on (app_account_id, type, entity_id, window_key)
// refuses the second write at the database. That is what lets boot catch-up be
// blunt instead of clever: run it again and nothing duplicates.
//
// `entity_id` + `window_key` are the dedup key and are NOT the navigation
// target. A maintenance notification dedupes on its task but opens the device.
// ============================================================

import pool from '../../db.js';
import {
  createNotifications,
  isNotificationTypeEnabled,
  readSettingNumber,
  readSettingString,
  type PreparedPush,
  type Queryable,
} from './notificationService.js';
import { dispatchPreparedPushes } from './pushDispatcher.js';

export interface SweepSummary {
  visitReminders: number;
  maintenanceDue: number;
  warrantyExpiring: number;
  /**
   * Candidates that matched a query but produced nothing. Two causes are folded
   * together on purpose — both are non-events for the sweep: the dedup index
   * refused a repeat, or the customer has no reachable app account (the common
   * case, since most customers never install the app).
   */
  skipped: number;
}

/**
 * How many days late a threshold may still fire.
 *
 * Warranty windows are matched against a remaining-days count, so a server that
 * was down on the day "30 days left" fell due would skip that notice
 * permanently and silently. The grace makes a missed day recoverable; the dedup
 * key (end_date + threshold) keeps it from firing twice.
 */
const THRESHOLD_GRACE_DAYS = 3;

function parseDayList(raw: string, fallback: number[]): number[] {
  const parsed = raw.split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return parsed.length > 0 ? parsed : fallback;
}

interface ProducerResult {
  sent: number;
  skipped: number;
}

/**
 * Visits happening on the target day, for customers who have a client record.
 *
 * No catch-up logic needed here: if the sweep does not run until tomorrow,
 * today's visits stop matching and the reminder is dropped — which is the
 * intended behaviour (D-N4). "You have a visit today" about a visit that
 * already happened is worse than silence.
 */
async function sweepVisitReminders(db: Queryable, out: PreparedPush[][]): Promise<ProducerResult> {
  const daysBefore = await readSettingNumber(db, 'notif_visit_reminder_days_before', 0);
  const { rows } = await db.query(
    `SELECT fv.id,
            fv.client_id,
            to_char(fv.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
            -- scheduled_time is a VARCHAR, not a time (same legacy typing that
            -- bit contracts.contract_date), so to_char() on it is a runtime
            -- error rather than a formatting choice. left() is the safe read.
            NULLIF(left(fv.scheduled_time, 5), '')    AS scheduled_time
       FROM field_visits fv
      WHERE fv.status = 'scheduled'
        AND fv.client_id IS NOT NULL
        AND fv.scheduled_date = CURRENT_DATE + $1::int`,
    [daysBefore],
  );

  const result: ProducerResult = { sent: 0, skipped: 0 };
  for (const row of rows) {
    const prepared = await createNotifications({
      type: 'visit_reminder',
      clientId: Number(row.client_id),
      destinationId: row.id,
      entityId: Number(row.id),
      // One reminder per visit per date. The date is in the key rather than
      // just the visit id so a future "remind again" policy stays possible.
      windowKey: row.scheduled_date,
      vars: { timeLabel: row.scheduled_time },
      db,
    });
    if (prepared.length > 0) { out.push(prepared); result.sent += 1; } else result.skipped += 1;
  }
  return result;
}

/**
 * Periodic-maintenance tasks that are due and still open.
 *
 * Two notifications at most (D-N5 `notif_maintenance_due_repeat_days`): one when
 * it falls due, one nudge later if the customer still has not acted. The cycle
 * is CAPPED at 1 rather than continuing — partly because the decision says one
 * repeat, and partly so that switching this feature on does not machine-gun a
 * backlog of long-overdue tasks with one notification per elapsed interval.
 */
async function sweepMaintenanceDue(db: Queryable, out: PreparedPush[][]): Promise<ProducerResult> {
  const repeatDays = await readSettingNumber(db, 'notif_maintenance_due_repeat_days', 14);
  const { rows } = await db.query(
    `SELECT ot.id,
            ot.client_id,
            ot.device_id,
            to_char(ot.due_date, 'YYYY-MM-DD') AS due_date,
            (CURRENT_DATE - ot.due_date)       AS days_overdue,
            COALESCE(NULLIF(d.device_model_name, ''), dm.name_ar, dm.name_en, dm.name) AS device_label
       FROM open_tasks ot
       LEFT JOIN installed_devices d ON d.id = ot.device_id
       LEFT JOIN device_models dm    ON dm.id = d.device_model_id
      WHERE ot.task_type = 'periodic_maintenance'
        AND ot.status NOT IN ('completed', 'closed', 'cancelled')
        AND ot.client_id IS NOT NULL
        AND ot.due_date IS NOT NULL
        AND ot.due_date <= CURRENT_DATE`,
  );

  const result: ProducerResult = { sent: 0, skipped: 0 };
  for (const row of rows) {
    const cycle = Number(row.days_overdue) >= repeatDays ? 1 : 0;
    const prepared = await createNotifications({
      type: 'maintenance_due',
      clientId: Number(row.client_id),
      // Dedupes on the task, navigates to the device.
      destinationId: row.device_id,
      entityId: Number(row.id),
      windowKey: `${row.due_date}#${cycle}`,
      vars: { deviceLabel: row.device_label },
      db,
    });
    if (prepared.length > 0) { out.push(prepared); result.sent += 1; } else result.skipped += 1;
  }
  return result;
}

/**
 * Active warranties approaching their end date, at each configured threshold.
 *
 * This is also the company's clearest sales window for the golden warranty, so
 * the thresholds are admin-tunable rather than fixed.
 */
async function sweepWarrantyExpiring(db: Queryable, out: PreparedPush[][]): Promise<ProducerResult> {
  const thresholds = parseDayList(
    await readSettingString(db, 'notif_warranty_expiry_days', '30,7'),
    [30, 7],
  );

  const result: ProducerResult = { sent: 0, skipped: 0 };
  for (const threshold of thresholds) {
    const { rows } = await db.query(
      `SELECT w.id,
              w.device_id,
              d.customer_id,
              to_char(w.end_date, 'YYYY-MM-DD') AS end_date,
              (w.end_date - CURRENT_DATE)       AS days_left
         FROM device_warranties w
         JOIN installed_devices d ON d.id = w.device_id
        WHERE w.status = 'active'
          AND w.end_date IS NOT NULL
          AND d.customer_id IS NOT NULL
          AND (w.end_date - CURRENT_DATE) <= $1::int
          AND (w.end_date - CURRENT_DATE) >= $1::int - $2::int`,
      [threshold, THRESHOLD_GRACE_DAYS],
    );

    for (const row of rows) {
      const prepared = await createNotifications({
        type: 'warranty_expiring',
        clientId: Number(row.customer_id),
        destinationId: row.device_id,
        entityId: Number(row.id),
        // Keyed on the threshold, not on the actual days left: inside the grace
        // window the real count varies, and the customer should hear about the
        // 30-day mark once, not once per day it slipped.
        windowKey: `${row.end_date}#${threshold}`,
        vars: { daysLeft: Number(row.days_left) },
        db,
      });
      if (prepared.length > 0) { out.push(prepared); result.sent += 1; } else result.skipped += 1;
    }
  }
  return result;
}

export async function runNotificationSweep(options: { db?: Queryable } = {}): Promise<SweepSummary> {
  const db = options.db ?? (pool as unknown as Queryable);
  const summary: SweepSummary = {
    visitReminders: 0, maintenanceDue: 0, warrantyExpiring: 0, skipped: 0,
  };
  const prepared: PreparedPush[][] = [];

  // The per-type kill switch is checked ONCE per producer rather than per
  // candidate (D-N15 note): a sweep can touch hundreds of rows, and the answer
  // cannot change mid-pass in any way that matters.
  if (await isNotificationTypeEnabled(db, 'visit_reminder')) {
    const r = await sweepVisitReminders(db, prepared);
    summary.visitReminders = r.sent;
    summary.skipped += r.skipped;
  }
  if (await isNotificationTypeEnabled(db, 'maintenance_due')) {
    const r = await sweepMaintenanceDue(db, prepared);
    summary.maintenanceDue = r.sent;
    summary.skipped += r.skipped;
  }
  if (await isNotificationTypeEnabled(db, 'warranty_expiring')) {
    const r = await sweepWarrantyExpiring(db, prepared);
    summary.warrantyExpiring = r.sent;
    summary.skipped += r.skipped;
  }

  // Rows first, pushes after — the same ordering rule as everywhere else, so a
  // push never refers to a row that is not yet durable.
  for (const batch of prepared) await dispatchPreparedPushes(batch);
  return summary;
}
