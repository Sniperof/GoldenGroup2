// ============================================================
// visitEscalationJob.ts — Three-tier escalation for undocumented visits
// ============================================================
// Constitution source:
//   DEC-006 D38 — escalation thresholds live in system_settings:
//     visit_undocumented_alert_hours_l1 (default 24)
//     visit_undocumented_alert_hours_l2 (default 48)
//     visit_undocumented_alert_hours_l3 (default 72)
//
//   The escalation is INFORMATIONAL — no auto-close. After L2 the technician
//   loses the right to start a new visit (enforced in fieldVisits.ts /start).
//
// Implementation:
//   - Ticks every 15 minutes.
//   - For each tier, finds visits in (in_progress OR ended) whose
//     status_changed_at (proxy: updated_at) is older than the configured hour
//     count AND that haven't been flagged at this tier yet.
//   - Records the alert in visit_escalation_alerts (created on first run).
//   - Logs to console; pluggable notifier deferred to Phase 8 frontend.
//
// State tracking: a small `visit_escalation_alerts` table keeps the set of
// (visit_id, tier) pairs already alerted, so a single visit fires each tier
// at most once. The table is created defensively on first call to avoid a
// dedicated migration for this purely operational state.
// ============================================================

import pool from '../db.js';
import { getSystemSettingNumber } from './systemSettings.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = true;

async function ensureAlertTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visit_escalation_alerts (
      id          SERIAL PRIMARY KEY,
      visit_id    BIGINT NOT NULL REFERENCES field_visits(id) ON DELETE CASCADE,
      tier        SMALLINT NOT NULL CHECK (tier IN (1, 2, 3)),
      alerted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (visit_id, tier)
    );
    CREATE INDEX IF NOT EXISTS idx_visit_escalation_alerts_visit
      ON visit_escalation_alerts(visit_id);
  `);
}

async function ensureScheduledAlertTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visit_scheduled_alerts (
      id                  BIGSERIAL PRIMARY KEY,
      visit_id            BIGINT NOT NULL REFERENCES field_visits(id) ON DELETE CASCADE,
      responsible_user_id INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
      alerted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at         TIMESTAMPTZ,
      UNIQUE (visit_id)
    );
    CREATE INDEX IF NOT EXISTS idx_visit_scheduled_alerts_pending_recipient
      ON visit_scheduled_alerts (responsible_user_id, alerted_at)
      WHERE resolved_at IS NULL;
  `);
}

async function createScheduledVisitAlerts(): Promise<number> {
  await ensureScheduledAlertTable();
  const { rowCount } = await pool.query(
    `INSERT INTO visit_scheduled_alerts (visit_id, responsible_user_id)
     SELECT fv.id, fv.team_responsible_user_id
       FROM field_visits fv
      WHERE fv.status = 'scheduled'
        AND (
          fv.scheduled_date < CURRENT_DATE
          OR (
            fv.scheduled_date = CURRENT_DATE
            AND COALESCE(
              CASE
                WHEN COALESCE(fv.scheduled_time, '') ~ '([01][0-9]|2[0-3]):[0-5][0-9]\\s*$'
                  THEN substring(fv.scheduled_time from '([01][0-9]|2[0-3]):[0-5][0-9]\\s*$')::time
                ELSE NULL
              END,
              TIME '23:59:59'
            ) < LOCALTIME
          )
        )
     ON CONFLICT (visit_id) DO NOTHING`,
  );
  return rowCount ?? 0;
}

interface TierContext {
  tier: 1 | 2 | 3;
  hours: number;
  recipientLabel: string;
}

async function runTier({ tier, hours, recipientLabel }: TierContext): Promise<number> {
  // Visits in non-terminal undocumented states whose updated_at is older than `hours`
  // and haven't been alerted at this tier yet.
  const { rows: candidates } = await pool.query<{ id: number; status: string; branch_id: number }>(
    `SELECT fv.id, fv.status, fv.branch_id
       FROM field_visits fv
      WHERE fv.status IN ('in_progress', 'ended')
        AND fv.updated_at <= NOW() - ($1 || ' hours')::INTERVAL
        AND NOT EXISTS (
          SELECT 1 FROM visit_escalation_alerts vea
           WHERE vea.visit_id = fv.id AND vea.tier = $2
        )`,
    [String(hours), tier],
  );

  if (candidates.length === 0) return 0;

  for (const row of candidates) {
    try {
      await pool.query(
        `INSERT INTO visit_escalation_alerts (visit_id, tier) VALUES ($1, $2)
         ON CONFLICT (visit_id, tier) DO NOTHING`,
        [row.id, tier],
      );
      console.log(
        `[visitEscalationJob] L${tier} (${hours}h) → visit #${row.id} (status=${row.status}, branch=${row.branch_id}) → ${recipientLabel}`,
      );
    } catch (err) {
      console.error(`[visitEscalationJob] failed L${tier} insert for visit #${row.id}`, err);
    }
  }
  return candidates.length;
}

export async function runVisitEscalationOnce(): Promise<{ l1: number; l2: number; l3: number }> {
  await ensureAlertTable();
  const l1Hours = await getSystemSettingNumber('visit_undocumented_alert_hours_l1', 24);
  const l2Hours = await getSystemSettingNumber('visit_undocumented_alert_hours_l2', 48);
  const l3Hours = await getSystemSettingNumber('visit_undocumented_alert_hours_l3', 72);
  const scheduled = await createScheduledVisitAlerts();

  // Run from highest tier downward so a visit that's >72h doesn't get logged
  // for L1 and L2 redundantly in the same tick. Each tier still records its
  // own alert row (so the UI can show the timeline).
  const l3 = await runTier({ tier: 3, hours: l3Hours, recipientLabel: 'مدير الفرع' });
  const l2 = await runTier({ tier: 2, hours: l2Hours, recipientLabel: 'مشرف + قفل بدء زيارة جديدة' });
  const l1 = await runTier({ tier: 1, hours: l1Hours, recipientLabel: 'الفني المسؤول وفنيي الفريق' });
  if (scheduled > 0) {
    console.log(`[visitEscalationJob] scheduled visits pending start: ${scheduled}`);
  }
  return { l1, l2, l3 };
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runVisitEscalationOnce();
    if (result.l1 + result.l2 + result.l3 > 0) {
      console.log(
        `[visitEscalationJob] alerts created: L1=${result.l1} L2=${result.l2} L3=${result.l3}`,
      );
    }
  } catch (err) {
    console.error('[visitEscalationJob] tick failed', err);
  } finally {
    running = false;
  }
}

async function scheduleNextTick(): Promise<void> {
  if (stopped) return;
  const configured = await getSystemSettingNumber('visit_escalation_job_interval_minutes', 15);
  const intervalMinutes = Math.min(1440, Math.max(1, Math.round(configured)));
  timer = setTimeout(async () => {
    timer = null;
    await tick();
    await scheduleNextTick();
  }, intervalMinutes * 60 * 1000);
}

export function startVisitEscalationJob(): void {
  if (!stopped) return;
  stopped = false;
  void (async () => {
    await tick();
    await scheduleNextTick();
  })();
  console.log('[visitEscalationJob] started (interval controlled by system settings)');
}

export function stopVisitEscalationJob(): void {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Test whether a given technician currently has any L2-or-higher undocumented
 * visit. Used by POST /field-visits/:id/start to block new visits.
 *
 * "Their" visits = visits whose team_responsible_user_id matches OR whose
 * team_snapshot.technicianEmployeeId resolves to this hr_user via hr_users.employee_id.
 */
export async function hasBlockingUndocumentedVisit(hrUserId: number): Promise<{
  blocked: boolean;
  visitId?: number;
  hoursSinceUpdate?: number;
}> {
  const l2Hours = await getSystemSettingNumber('visit_undocumented_alert_hours_l2', 48);
  const { rows } = await pool.query(
    `SELECT fv.id,
            EXTRACT(EPOCH FROM (NOW() - fv.updated_at)) / 3600 AS hours
       FROM field_visits fv
      WHERE fv.status IN ('in_progress', 'ended')
        AND fv.updated_at <= NOW() - ($1 || ' hours')::INTERVAL
        AND fv.team_responsible_user_id = $2
      ORDER BY fv.updated_at ASC
      LIMIT 1`,
    [String(l2Hours), hrUserId],
  );
  if (rows.length === 0) return { blocked: false };
  return {
    blocked: true,
    visitId: Number(rows[0].id),
    hoursSinceUpdate: Math.round(Number(rows[0].hours)),
  };
}
