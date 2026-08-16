import type { PoolClient } from 'pg';
import pool from '../db.js';
import { lockPlanningDayMutation } from './planningTaskCuration.js';

export type PlanningDayCycleStatus = 'planning' | 'ready' | 'active' | 'closing' | 'closed';
export type PlanningDayCycleCloseReason = 'plan_ended_manual' | 'plan_ended_automatic';

export type PlanningDayCycleSummary = {
  contactTargetsClosed: number;
  taskListsClosed: number;
  linksClosed: number;
  tasksReleased: number;
  preservedBookings: number;
  activeLocks: number;
};

export class PlanningDayCycleError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}

type Queryable = Pick<PoolClient, 'query'>;

const EMPTY_SUMMARY: PlanningDayCycleSummary = {
  contactTargetsClosed: 0,
  taskListsClosed: 0,
  linksClosed: 0,
  tasksReleased: 0,
  preservedBookings: 0,
  activeLocks: 0,
};

function validateScope(branchId: number, date: string, teamKey: string) {
  if (!Number.isInteger(branchId) || branchId <= 0) {
    throw new PlanningDayCycleError('A branch context is required', 'BRANCH_REQUIRED', 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new PlanningDayCycleError('date must be YYYY-MM-DD', 'INVALID_DATE', 400);
  }
  if (!/^(team|solo)_\d+$/.test(teamKey)) {
    throw new PlanningDayCycleError('teamKey must be team_X or solo_X', 'INVALID_TEAM_KEY', 400);
  }
}

export async function getPlanningDayCycle(
  db: Queryable,
  branchId: number,
  date: string,
  teamKey: string,
) {
  validateScope(branchId, date, teamKey);
  const { rows } = await db.query(
    `SELECT
       status,
       activated_at AS "activatedAt",
       closed_at AS "closedAt",
       closed_by AS "closedBy",
       close_reason AS "closeReason",
       closure_summary AS "closureSummary"
     FROM planning_day_cycles
     WHERE branch_id = $1 AND planning_date = $2::date AND team_key = $3`,
    [branchId, date, teamKey],
  );
  return rows[0] ?? {
    status: 'planning' as PlanningDayCycleStatus,
    activatedAt: null,
    closedAt: null,
    closedBy: null,
    closeReason: null,
    closureSummary: EMPTY_SUMMARY,
  };
}

export async function assertPlanningDayCycleWritable(
  db: Queryable,
  branchId: number,
  date: string,
  teamKey: string,
) {
  const cycle = await getPlanningDayCycle(db, branchId, date, teamKey);
  if (cycle.status === 'closing' || cycle.status === 'closed') {
    throw new PlanningDayCycleError(
      'تم إغلاق دورة التخطيط لهذا الفريق واليوم ولا يمكن تعديلها',
      'PLANNING_DAY_CLOSED',
      409,
    );
  }
  return cycle;
}

export async function markPlanningDayCycleActive(
  db: Queryable,
  branchId: number,
  date: string,
  teamKey: string,
) {
  await assertPlanningDayCycleWritable(db, branchId, date, teamKey);
  await db.query(
    `INSERT INTO planning_day_cycles (
       branch_id, planning_date, team_key, status, activated_at
     ) VALUES ($1, $2::date, $3, 'active', now())
     ON CONFLICT (branch_id, planning_date, team_key) DO UPDATE
       SET status = 'active',
           activated_at = COALESCE(planning_day_cycles.activated_at, now()),
           updated_at = now()
       WHERE planning_day_cycles.status NOT IN ('closing', 'closed')`,
    [branchId, date, teamKey],
  );
}

async function loadPreview(
  db: Queryable,
  branchId: number,
  date: string,
  teamKey: string,
): Promise<PlanningDayCycleSummary> {
  const { rows } = await db.query(
    `WITH scoped_targets AS (
       SELECT id, status, locked_by_hr_user_id
       FROM contact_targets
       WHERE branch_id = $1 AND date = $2::date AND team_key = $3
     ), releasable_tasks AS (
       SELECT DISTINCT ot.id
       FROM open_tasks ot
       WHERE (
         ot.branch_id = $1
         AND ot.assigned_for_date = $2::date
         AND ot.assigned_team_key = $3
         AND ot.status = 'assigned'
       ) OR (
         ot.status = 'in_scheduling'
         AND EXISTS (
           SELECT 1
           FROM contact_target_open_tasks ctot
           JOIN scoped_targets st ON st.id = ctot.contact_target_id
           WHERE ctot.open_task_id = ot.id
             AND st.status IN ('new', 'queued', 'in_call_list', 'contacted')
         )
       )
     )
     SELECT
       COUNT(*) FILTER (WHERE st.status IN ('new', 'queued', 'in_call_list', 'contacted'))::int AS "contactTargetsClosed",
       (SELECT COUNT(*)::int FROM telemarketing_task_lists tl
         WHERE tl.branch_id = $1 AND tl.date::date = $2::date AND tl.team_key = $3 AND tl.status = 'open') AS "taskListsClosed",
       (SELECT COUNT(*)::int FROM contact_target_open_tasks ctot
         JOIN scoped_targets linked ON linked.id = ctot.contact_target_id
         WHERE ctot.link_status <> 'closed'
           AND linked.status IN ('new', 'queued', 'in_call_list', 'contacted')) AS "linksClosed",
       (SELECT COUNT(*)::int FROM releasable_tasks) AS "tasksReleased",
       COUNT(*) FILTER (WHERE st.status = 'booked')::int AS "preservedBookings",
       COUNT(*) FILTER (
         WHERE st.locked_by_hr_user_id IS NOT NULL
           AND st.status IN ('new', 'queued', 'in_call_list', 'contacted')
       )::int AS "activeLocks"
     FROM scoped_targets st`,
    [branchId, date, teamKey],
  );
  return { ...EMPTY_SUMMARY, ...(rows[0] ?? {}) };
}

export async function previewPlanningDayCycleClose(params: {
  branchId: number;
  date: string;
  teamKey: string;
}): Promise<{ cycle: Awaited<ReturnType<typeof getPlanningDayCycle>>; summary: PlanningDayCycleSummary }> {
  validateScope(params.branchId, params.date, params.teamKey);
  const cycle = await getPlanningDayCycle(pool, params.branchId, params.date, params.teamKey);
  const summary = cycle.status === 'closed'
    ? { ...EMPTY_SUMMARY, ...(cycle.closureSummary ?? {}) }
    : await loadPreview(pool, params.branchId, params.date, params.teamKey);
  return { cycle, summary };
}

export async function closePlanningDayCycle(params: {
  branchId: number;
  date: string;
  teamKey: string;
  closedBy: number | null;
  reason: PlanningDayCycleCloseReason;
}): Promise<{ alreadyClosed: boolean; summary: PlanningDayCycleSummary }> {
  validateScope(params.branchId, params.date, params.teamKey);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await lockPlanningDayMutation(db, params.branchId, params.date);

    await db.query(
      `INSERT INTO planning_day_cycles (branch_id, planning_date, team_key, status)
       VALUES ($1, $2::date, $3, 'planning')
       ON CONFLICT (branch_id, planning_date, team_key) DO NOTHING`,
      [params.branchId, params.date, params.teamKey],
    );
    const { rows: cycleRows } = await db.query(
      `SELECT status, closure_summary AS "closureSummary"
       FROM planning_day_cycles
       WHERE branch_id = $1 AND planning_date = $2::date AND team_key = $3
       FOR UPDATE`,
      [params.branchId, params.date, params.teamKey],
    );
    if (cycleRows[0]?.status === 'closed') {
      await db.query('COMMIT');
      return {
        alreadyClosed: true,
        summary: { ...EMPTY_SUMMARY, ...(cycleRows[0].closureSummary ?? {}) },
      };
    }

    await db.query(
      `UPDATE planning_day_cycles
       SET status = 'closing', updated_at = now()
       WHERE branch_id = $1 AND planning_date = $2::date AND team_key = $3`,
      [params.branchId, params.date, params.teamKey],
    );

    const preview = await loadPreview(db, params.branchId, params.date, params.teamKey);
    const { rows: targetRows } = await db.query<{ id: string }>(
      `UPDATE contact_targets
       SET status = 'closed',
           closing_reason = $4,
           closed_by = $5,
           closed_at = now(),
           locked_by_hr_user_id = NULL,
           locked_at = NULL,
           updated_at = now()
       WHERE branch_id = $1 AND date = $2::date AND team_key = $3
         AND status IN ('new', 'queued', 'in_call_list', 'contacted')
       RETURNING id`,
      [params.branchId, params.date, params.teamKey, params.reason, params.closedBy],
    );
    const targetIds = targetRows.map((row) => Number(row.id));

    let linksClosed = 0;
    if (targetIds.length > 0) {
      const links = await db.query(
        `UPDATE contact_target_open_tasks
         SET link_status = 'closed', updated_at = now()
         WHERE contact_target_id = ANY($1::bigint[]) AND link_status <> 'closed'`,
        [targetIds],
      );
      linksClosed = links.rowCount ?? 0;
    }

    const released = await db.query<{
      id: number;
      oldStatus: string;
      newStatus: string;
    }>(
      `WITH candidates AS (
         SELECT DISTINCT
           ot.id,
           ot.status AS old_status,
           COALESCE(NULLIF(ot.last_waiting_status, ''), 'open') AS new_status
         FROM open_tasks ot
         WHERE (
           ot.branch_id = $1
           AND ot.assigned_for_date = $2::date
           AND ot.assigned_team_key = $3
           AND ot.status = 'assigned'
         ) OR (
           ot.status = 'in_scheduling'
           AND EXISTS (
             SELECT 1 FROM contact_target_open_tasks ctot
             WHERE ctot.contact_target_id = ANY($4::bigint[])
               AND ctot.open_task_id = ot.id
           )
         )
       )
       UPDATE open_tasks ot
       SET status = candidates.new_status,
           assigned_team_key = NULL,
           assigned_for_date = NULL,
           assigned_at = NULL,
           assigned_scope_id = NULL,
           updated_at = now()
       FROM candidates
       WHERE ot.id = candidates.id
       RETURNING ot.id, candidates.old_status AS "oldStatus", candidates.new_status AS "newStatus"`,
      [params.branchId, params.date, params.teamKey, targetIds],
    );

    for (const task of released.rows) {
      await db.query(
        `INSERT INTO task_activity_log (
           task_id, event_type, performed_by, old_value, new_value, reason
         ) VALUES ($1, 'status_change', $2, $3, $4, $5)`,
        [task.id, params.closedBy, task.oldStatus, task.newStatus, params.reason],
      );
    }

    const lists = await db.query(
      `UPDATE telemarketing_task_lists
       SET status = 'closed', closed_at = now(), close_reason = $4
       WHERE branch_id = $1 AND date::date = $2::date AND team_key = $3 AND status <> 'closed'`,
      [params.branchId, params.date, params.teamKey, params.reason],
    );

    const summary: PlanningDayCycleSummary = {
      contactTargetsClosed: targetRows.length,
      taskListsClosed: lists.rowCount ?? 0,
      linksClosed,
      tasksReleased: released.rowCount ?? 0,
      preservedBookings: preview.preservedBookings,
      activeLocks: preview.activeLocks,
    };
    await db.query(
      `UPDATE planning_day_cycles
       SET status = 'closed',
           closed_at = now(),
           closed_by = $4,
           close_reason = $5,
           closure_summary = $6::jsonb,
           updated_at = now()
       WHERE branch_id = $1 AND planning_date = $2::date AND team_key = $3`,
      [params.branchId, params.date, params.teamKey, params.closedBy, params.reason, JSON.stringify(summary)],
    );

    await db.query('COMMIT');
    return { alreadyClosed: false, summary };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export async function closeExpiredPlanningDayCycles(includeCurrentDate: boolean) {
  const comparison = includeCurrentDate ? '<=' : '<';
  const candidates = await pool.query<{
    branchId: number;
    date: string;
    teamKey: string;
  }>(
    `SELECT DISTINCT
       source.branch_id AS "branchId",
       source.planning_date::text AS date,
       source.team_key AS "teamKey"
     FROM (
       SELECT branch_id, planning_date, team_key
       FROM planning_day_cycles
       WHERE status <> 'closed' AND planning_date ${comparison} CURRENT_DATE
       UNION
       SELECT branch_id, date AS planning_date, team_key
       FROM contact_targets
       WHERE status NOT IN ('closed', 'cancelled', 'booked')
         AND branch_id IS NOT NULL AND date IS NOT NULL AND team_key IS NOT NULL
         AND date ${comparison} CURRENT_DATE
       UNION
       SELECT branch_id, date::date AS planning_date, team_key
       FROM telemarketing_task_lists
       WHERE status <> 'closed' AND branch_id IS NOT NULL
         AND date::date ${comparison} CURRENT_DATE
       UNION
       SELECT branch_id, assigned_for_date AS planning_date, assigned_team_key AS team_key
       FROM open_tasks
       WHERE status = 'assigned'
         AND branch_id IS NOT NULL
         AND assigned_for_date IS NOT NULL
         AND assigned_team_key IS NOT NULL
         AND assigned_for_date ${comparison} CURRENT_DATE
     ) source`,
  );

  let cyclesClosed = 0;
  let contactTargetsClosed = 0;
  for (const candidate of candidates.rows) {
    const result = await closePlanningDayCycle({
      branchId: candidate.branchId,
      date: candidate.date,
      teamKey: candidate.teamKey,
      closedBy: null,
      reason: 'plan_ended_automatic',
    });
    if (!result.alreadyClosed) cyclesClosed += 1;
    contactTargetsClosed += result.summary.contactTargetsClosed;
  }
  return { cyclesClosed, contactTargetsClosed };
}
