// ============================================================
// visitCompletion.ts — Auto-complete a field_visit when guards pass
// ============================================================
// Constitution source:
//   DEC-007 D44  — completion guards: (1) every visit_task has a result,
//                  (2) visit_survey exists (filled OR is_skipped + reason).
//                  Referral sheet is OPTIONAL (DEC-007 D45).
//   DEC-007 P-DEC007-04 — completed is calculated, not manual. Called after
//                  every task_result / survey / survey-skip save.
//
// Called from:
//   - POST /field-visits/:id/survey
//   - POST /field-visits/:id/survey/skip
//   - POST /field-visits/:id/tasks/:tid/result   (Phase 7 wiring)
//   - POST /field-visits/:id/complete            (manual fallback)
//
// Safe to call repeatedly: returns { completed: false, reason } when guards
// fail and { completed: true } when transition occurred (or was already done).
// ============================================================

import type { PoolClient } from 'pg';
import pool from '../db.js';

export interface CheckResult {
  completed: boolean;
  alreadyCompleted?: boolean;
  reason?: string;
  pendingTaskCount?: number;
  missing?: ('tasks' | 'survey')[];
}

/**
 * Runs the DEC-007 D44 guards and, if they pass and the visit is in `ended`
 * (or `in_progress`), transitions to `completed`.
 *
 * The function uses an existing PoolClient when one is passed (so callers can
 * keep the transition inside their own transaction), otherwise opens a new
 * connection from the pool.
 */
export async function checkAndCompleteVisit(
  visitId: number,
  closedByUserId: number | null = null,
  db?: PoolClient,
): Promise<CheckResult> {
  const useExternal = db != null;
  const client = useExternal ? (db as PoolClient) : await pool.connect();
  try {
    if (!useExternal) await client.query('BEGIN');

    // 1. Load the visit's current status
    const { rows: visitRows } = await client.query<{ id: number; status: string }>(
      'SELECT id, status FROM field_visits WHERE id = $1 LIMIT 1',
      [visitId],
    );
    if (visitRows.length === 0) {
      if (!useExternal) await client.query('ROLLBACK');
      return { completed: false, reason: 'visit_not_found' };
    }
    const status = visitRows[0].status;
    if (status === 'completed') {
      if (!useExternal) await client.query('COMMIT');
      return { completed: true, alreadyCompleted: true };
    }
    // Only auto-advance from in_progress or ended. cancelled / not_completed
    // are terminal and managed by their own flows.
    if (status !== 'in_progress' && status !== 'ended') {
      if (!useExternal) await client.query('ROLLBACK');
      return { completed: false, reason: `status_not_eligible:${status}` };
    }

    // 2. Guard 1 (DEC-007 D44 §1): every visit_task has a visit_task_result
    //    with final_decision != NULL.
    const { rows: pendingTasks } = await client.query<{ pending: number }>(
      `SELECT COUNT(*)::int AS pending
         FROM visit_tasks vt
         LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
        WHERE vt.field_visit_id = $1
          AND (vtr.id IS NULL OR vtr.final_decision IS NULL)`,
      [visitId],
    );
    const pendingTaskCount = Number(pendingTasks[0]?.pending ?? 0);

    // 3. Guard 2 (DEC-007 D44 §2): visit_surveys exists for this visit (filled
    //    or skipped — the CHECK constraint in migration 214 guarantees a row
    //    is valid only if one branch is satisfied).
    const { rows: surveyRows } = await client.query<{ has_survey: number }>(
      `SELECT COUNT(*)::int AS has_survey
         FROM visit_surveys
        WHERE field_visit_id = $1`,
      [visitId],
    );
    const hasSurvey = Number(surveyRows[0]?.has_survey ?? 0) > 0;

    const missing: ('tasks' | 'survey')[] = [];
    if (pendingTaskCount > 0) missing.push('tasks');
    if (!hasSurvey) missing.push('survey');

    if (missing.length > 0) {
      if (!useExternal) await client.query('ROLLBACK');
      return {
        completed: false,
        reason: 'guards_failed',
        pendingTaskCount,
        missing,
      };
    }

    // 4. Guards pass — transition to completed.
    await client.query(
      `UPDATE field_visits
          SET status     = 'completed',
              closed_by  = COALESCE(closed_by, $2),
              closed_at  = COALESCE(closed_at, NOW()),
              updated_at = NOW()
        WHERE id = $1`,
      [visitId, closedByUserId],
    );

    if (!useExternal) await client.query('COMMIT');
    return { completed: true };
  } catch (err) {
    if (!useExternal) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (!useExternal) (client as PoolClient).release();
  }
}
