// ============================================================
// services/appNotifications/outboxConsumer.ts
// ============================================================
// DEC-019 D-N15 — turns captured status changes into notifications.
//
// The trigger in migration 427 records EVERY status change on service_requests
// and field_visits. This module is the single place that decides which of them
// a customer should hear about. Concentrating that judgement here is the point
// of the design: the alternative was the same judgement duplicated across 13
// call sites, where forgetting one is invisible.
//
// Each row is processed in its OWN transaction, and the notification rows are
// written in that same transaction as the row is marked processed. So a row is
// consumed exactly once even if the process dies mid-drain; only the push
// itself is at-least-once, which the dedup index and an idempotent mark-read
// already tolerate.
// ============================================================

import pool from '../../db.js';
import type { PoolClient } from 'pg';
import {
  notifyComplaintPublicUpdate,
  notifyServiceRequestStatusChanged,
  notifyVisitCancelled,
  notifyVisitCompleted,
  notifyVisitScheduled,
} from './notify.js';
import { dispatchPreparedPushes } from './pushDispatcher.js';
import type { PreparedPush } from './notificationService.js';

/** After this many failures a row stops being retried so it cannot block the queue. */
export const MAX_ATTEMPTS = 5;

export interface OutboxRow {
  id: string;
  entity_type: 'service_request' | 'field_visit' | 'complaint_public_update';
  entity_id: string;
  from_status: string | null;
  to_status: string;
}

export interface DrainSummary {
  processed: number;
  notified: number;
  skipped: number;
  failed: number;
}

/** Terminal visit states that mean "the visit happened and is closed out". */
const VISIT_DONE = new Set(['completed', 'closed']);

/**
 * Decides what a captured visit transition means to the customer.
 *
 * `completed` and `closed` are two internal steps of one customer-visible fact
 * (DEC-017 D-AV2 collapses both to "completed"), so only the FIRST entry into
 * that pair notifies — otherwise a visit that is completed and then closed would
 * thank the customer twice. Reactive types carry no dedup key, so nothing else
 * would catch that.
 *
 * `in_progress`, `ended` and `not_completed` are deliberately silent: the first
 * two are internal progress, and `not_completed` is a conversation for a human,
 * not a push.
 */
export function decideVisitEvent(
  fromStatus: string | null,
  toStatus: string,
): 'scheduled' | 'cancelled' | 'completed' | null {
  if (toStatus === 'scheduled') return 'scheduled';
  if (toStatus === 'cancelled') return 'cancelled';
  if (VISIT_DONE.has(toStatus) && !VISIT_DONE.has(fromStatus ?? '')) return 'completed';
  return null;
}

async function handleServiceRequest(
  db: PoolClient,
  row: OutboxRow,
): Promise<{ prepared: PreparedPush[]; skipReason: string | null }> {
  const { rows } = await db.query(
    'SELECT beneficiary_client_id, request_type FROM service_requests WHERE id = $1',
    [row.entity_id],
  );
  // The source row can be gone by the time we get here; the outbox deliberately
  // has no FK so history survives, which means this case is normal, not broken.
  if (rows.length === 0) return { prepared: [], skipReason: 'entity_missing' };

  const prepared = await notifyServiceRequestStatusChanged(db, {
    serviceRequestId: row.entity_id,
    clientId: rows[0].beneficiary_client_id,
    requestType: rows[0].request_type,
    status: row.to_status,
  });
  return {
    prepared,
    // The facade already owns every reason to stay silent (non-terminal status,
    // account_creation, no linked client); an empty result is one of those.
    skipReason: prepared.length === 0 ? 'no_notification_for_status' : null,
  };
}

async function handleFieldVisit(
  db: PoolClient,
  row: OutboxRow,
): Promise<{ prepared: PreparedPush[]; skipReason: string | null }> {
  const event = decideVisitEvent(row.from_status, row.to_status);
  if (event === null) return { prepared: [], skipReason: 'not_notifiable_status' };

  const visitId = Number(row.entity_id);
  const prepared = event === 'scheduled'
    ? await notifyVisitScheduled(db, { visitId })
    : event === 'cancelled'
      ? await notifyVisitCancelled(db, { visitId })
      : await notifyVisitCompleted(db, { visitId });

  return { prepared, skipReason: prepared.length === 0 ? 'no_recipient' : null };
}

async function handleComplaintPublicUpdate(
  db: PoolClient,
  row: OutboxRow,
): Promise<{ prepared: PreparedPush[]; skipReason: string | null }> {
  // No status filter here: every row in complaint_public_updates is already a
  // message meant for the complainant (D-N16). The only exclusions live in the
  // facade — the intake confirmation, and complaints filed without an account.
  const prepared = await notifyComplaintPublicUpdate(db, {
    publicUpdateId: Number(row.entity_id),
  });
  return { prepared, skipReason: prepared.length === 0 ? 'no_recipient_or_intake_row' : null };
}

/**
 * Processes one claimed outbox row. Exported for tests; callers should use
 * drainOutbox, which owns the claiming and the transaction.
 */
export async function processOutboxRow(
  db: PoolClient,
  row: OutboxRow,
): Promise<{ prepared: PreparedPush[]; skipReason: string | null }> {
  if (row.entity_type === 'service_request') return handleServiceRequest(db, row);
  if (row.entity_type === 'complaint_public_update') return handleComplaintPublicUpdate(db, row);
  return handleFieldVisit(db, row);
}

/**
 * Drains up to `limit` pending rows.
 *
 * FOR UPDATE SKIP LOCKED so two workers (or two PM2 cluster workers) can drain
 * the same queue without either blocking or double-handling a row.
 */
export async function drainOutbox(limit = 50): Promise<DrainSummary> {
  const summary: DrainSummary = { processed: 0, notified: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < limit; i += 1) {
    const client = await pool.connect();
    let prepared: PreparedPush[] = [];
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, entity_type, entity_id, from_status, to_status
           FROM app_notification_outbox
          WHERE processed_at IS NULL AND attempts < $1
          ORDER BY id
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [MAX_ATTEMPTS],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        break;
      }
      const row = rows[0];

      try {
        const outcome = await processOutboxRow(client, row);
        prepared = outcome.prepared;
        await client.query(
          `UPDATE app_notification_outbox
              SET processed_at = NOW(), skip_reason = $2, last_error = NULL
            WHERE id = $1`,
          [row.id, outcome.skipReason],
        );
        await client.query('COMMIT');
        summary.processed += 1;
        if (prepared.length > 0) summary.notified += 1; else summary.skipped += 1;
      } catch (err) {
        // Roll back the attempt, then record the failure in its own transaction:
        // the counter must survive the rollback or a poison row retries forever.
        await client.query('ROLLBACK');
        await client.query(
          `UPDATE app_notification_outbox
              SET attempts = attempts + 1, last_error = $2
            WHERE id = $1`,
          [row.id, String((err as Error)?.message ?? err).slice(0, 500)],
        );
        summary.failed += 1;
        console.error(`[outbox] row ${row.id} failed (attempt ${'>'}=1)`, err);
        continue;
      }
    } finally {
      client.release();
    }

    // Outside the transaction on purpose: the push must not leave before the
    // rows it refers to are durable.
    if (prepared.length > 0) await dispatchPreparedPushes(prepared);
  }

  return summary;
}
