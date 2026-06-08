// ============================================================
// serviceRequests/cronAutoCancel.ts
// ============================================================
// Constitution source: §٠.٤.ج — Auto-cancel awaiting_customer_info
//
// Rule (V1.0):
//   Any service_request in awaiting_customer_info for longer than
//   `service_request_awaiting_auto_cancel_days` days transitions to
//   cancelled with triage_outcome='customer_no_response' and
//   actor_role='system' in the audit log.
//
// "Longer than X days" is measured from the most recent
// customer_info_requested event (i.e. the last entry into the
// awaiting state) — captured via service_request_audit_log.
//
// Intended invocation: daily cron at 22:00. The runner walks
// candidates and runs transitionStatus for each. Failures are
// logged and the loop continues so a single bad row does not
// block the batch.
// ============================================================

import pool from '../../db.js';
import { transitionStatus } from './stateMachine.js';

interface RunResult {
  candidatesFound: number;
  cancelled: number;
  failures: Array<{ serviceRequestId: number; code: string; message?: string }>;
  thresholdDays: number;
}

export async function runAutoCancelAwaitingCustomerInfo(): Promise<RunResult> {
  const settings = await pool.query<{ value: string }>(
    `SELECT value FROM system_settings
      WHERE key = 'service_request_awaiting_auto_cancel_days'
      LIMIT 1`,
  );
  const thresholdDays = parseInt(settings.rows[0]?.value ?? '7', 10);

  // Candidates: status = awaiting_customer_info AND the most recent
  // entry into awaiting_customer_info is older than thresholdDays.
  const { rows: candidates } = await pool.query<{ id: number }>(
    `WITH last_await AS (
       SELECT service_request_id, MAX(created_at) AS last_await_at
         FROM service_request_audit_log
        WHERE event_type = 'customer_info_requested'
        GROUP BY service_request_id
     )
     SELECT sr.id
       FROM service_requests sr
       JOIN last_await la ON la.service_request_id = sr.id
      WHERE sr.status = 'awaiting_customer_info'
        AND la.last_await_at < NOW() - ($1 || ' days')::interval`,
    [thresholdDays],
  );

  const failures: RunResult['failures'] = [];
  let cancelled = 0;
  for (const c of candidates) {
    try {
      const result = await transitionStatus({
        serviceRequestId: c.id,
        toStatus: 'cancelled',
        actorUserId: null,
        actorRole: 'system',
        triageOutcome: 'customer_no_response',
        note: `auto-cancelled: ${thresholdDays}d in awaiting_customer_info`,
        payloadExtra: { auto_cancelled: true, threshold_days: thresholdDays },
      });
      if (result.ok === true) {
        cancelled += 1;
      } else {
        failures.push({ serviceRequestId: c.id, code: result.code, message: result.message });
      }
    } catch (err) {
      failures.push({
        serviceRequestId: c.id,
        code: 'unexpected_error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    candidatesFound: candidates.length,
    cancelled,
    failures,
    thresholdDays,
  };
}
