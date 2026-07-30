import pool from '../db.js';
import { getPlanningWorkScope } from './planningMarketingTargets.js';
import { resolveAssignmentOwningBranch } from '../policies/routeAssignmentPolicy.js';
import { buildPlanningTaskAvailablePredicate } from './planningContactTargetScope.js';
import { lockPlanningDayMutation } from './planningTaskCuration.js';

/** Thrown when a team is asked to plan/assign a branch it does not belong to. */
export class CrossBranchAssignmentError extends Error {
  constructor(public readonly teamKey: string, public readonly owningBranchId: number, public readonly requestedBranchId: number) {
    super(`تعذّر الإسناد: الفريق ${teamKey} يتبع الفرع ${owningBranchId} لا الفرع ${requestedBranchId} — لا يجوز إسناد مهام فرع لفريق فرع آخر`);
    this.name = 'CrossBranchAssignmentError';
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

const WAITING_STATES = new Set(['open', 'needs_follow_up']);

export type AssignedTaskSyncResult = {
  plannedTaskIds: number[];
  eligibleTaskIds: number[];
  newlyAssignedIds: number[];
  releasedIds: number[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0] ?? null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0] ?? null;
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Reconciles assigned open_tasks for a team/date with the current work scope.
 *
 * Fixes applied vs. earlier version:
 *   FIX-1 (last_waiting_status): saved at the moment a task moves to 'assigned'
 *          so exclude/restore can always restore the exact original phase.
 *   FIX-2 (transaction): accepts an optional `db` client so the caller can wrap
 *          this in its own transaction; falls back to pool when none is provided.
 *   FIX-3 (N-window): only tasks already in the work scope (which applies the
 *          N-window + ownership + zone filters) become eligible. The old approach
 *          of fetching all tasks for eligible clients bypassed N-window.
 */
export async function syncAssignedTasks(params: {
  date: string;
  teamKey: string;
  branchId: number;
  scopeId?: number | null;
  performedBy?: number | null;
  db?: { query: typeof pool.query };   // optional transaction client (FIX-2)
}): Promise<AssignedTaskSyncResult> {
  if (!params.db) {
    const transaction = await pool.connect();
    try {
      await transaction.query('BEGIN');
      const result = await syncAssignedTasks({ ...params, db: transaction });
      await transaction.query('COMMIT');
      return result;
    } catch (error) {
      await transaction.query('ROLLBACK');
      throw error;
    } finally {
      transaction.release();
    }
  }

  const { date, teamKey, branchId, scopeId = null, performedBy = null } = params;
  const db = params.db;
  await lockPlanningDayMutation(db, branchId, date);

  // ── Step 0 (branch-isolation guard, GAP-DS-005 / PL-R005): the team's owning
  // branch is DERIVED from its scheduled supervisor (day_schedules has no branch_id).
  // Every write path funnels through here, but only route_assignments passes the
  // derived owning branch — workScopes/planning trust an independent branchId, which
  // let a foreign-branch task (e.g. Tartous task on a Damascus team) be assigned.
  // Reject the mismatch at the single write chokepoint. When the owning branch can't
  // be derived (team not scheduled yet) we stay permissive, per routeAssignmentPolicy.
  const owningBranchId = await resolveAssignmentOwningBranch(date, teamKey, db);
  if (owningBranchId != null && owningBranchId !== branchId) {
    throw new CrossBranchAssignmentError(teamKey, owningBranchId, branchId);
  }

  // ── Step 1: eligible task IDs from work scope (N-window + ownership + zone already applied)
  // FIX-3: do NOT expand to all client tasks — use only what workScope approved.
  // The scope is read through the same transaction so route/schedule/task state
  // is reconciled as one planning-day mutation.
  const workScope = await getPlanningWorkScope({ date, teamKey, branchId, db });
  const plannedTaskIds = Array.from(
    new Set(
      workScope.tasks
        .map(t => Number(t.openTaskId))
        .filter(id => Number.isInteger(id) && id > 0),
    ),
  );

  // ── Step 2: currently-assigned tasks for this team/date (needed to compute released)
  const { rows: currentlyAssignedRows } = await db.query<{
    id: number;
    lastWaitingStatus: string | null;
  }>(
    `SELECT id, last_waiting_status AS "lastWaitingStatus"
       FROM open_tasks
      WHERE status = 'assigned'
        AND assigned_team_key = $1
        AND assigned_for_date = $2
        AND branch_id = $3
      ORDER BY id
      FOR UPDATE`,
    [teamKey, date, branchId],
  );
  const currentlyAssignedIds = currentlyAssignedRows.map(r => Number(r.id));
  const currentlyAssignedSet = new Set(currentlyAssignedIds);
  const lastWaitingByAssigned = new Map<number, string>(
    currentlyAssignedRows.map(r => [Number(r.id), r.lastWaitingStatus ?? 'open']),
  );

  if (plannedTaskIds.length === 0 && currentlyAssignedIds.length === 0) {
    return { plannedTaskIds: [], eligibleTaskIds: [], newlyAssignedIds: [], releasedIds: [] };
  }

  // ── Step 3: fetch current status of planned tasks
  const taskRowMap = new Map<number, { status: string; excludedForDate: string | null; lastWaitingStatus: string | null }>();
  if (plannedTaskIds.length > 0) {
    const { rows } = await db.query<{
      id: number;
      status: string;
      excludedForDate: string | null;
      lastWaitingStatus: string | null;
    }>(
      `SELECT id, status,
              excluded_for_date   AS "excludedForDate",
              last_waiting_status AS "lastWaitingStatus"
         FROM open_tasks
        WHERE id = ANY($1::int[])
          AND branch_id = $2
          AND ${buildPlanningTaskAvailablePredicate('open_tasks', '$3', '$4')}
        ORDER BY id
        FOR UPDATE`,
      [plannedTaskIds, branchId, teamKey, date],
    );
    rows.forEach(r => taskRowMap.set(Number(r.id), r));
  }

  // ── Step 4: filter planned tasks to those in a waiting state and not excluded today
  const eligibleTaskIds = plannedTaskIds.filter(id => {
    const row = taskRowMap.get(id);
    if (!row) return false;
    if (!WAITING_STATES.has(row.status) && row.status !== 'assigned') return false;
    return toDateString(row.excludedForDate) !== date;
  });
  const eligibleTaskSet = new Set(eligibleTaskIds);

  // ── Step 5: diff
  // newly_assigned = eligible (in waiting state) that aren't already assigned
  let newlyAssignedIds = eligibleTaskIds.filter(id => {
    const row = taskRowMap.get(id);
    return !currentlyAssignedSet.has(id) && row != null && WAITING_STATES.has(row.status);
  });
  // released = currently assigned for this team but no longer eligible
  let releasedIds = currentlyAssignedIds.filter(id => !eligibleTaskSet.has(id));

  // ── Step 6: write newly assigned
  if (newlyAssignedIds.length > 0) {
    const { rows: assignedRows } = await db.query(
      // FIX-1: last_waiting_status = status captures 'open' or 'needs_follow_up'
      // before overwriting status with 'assigned', enabling correct restoration.
      `UPDATE open_tasks
          SET last_waiting_status = status,
              status              = 'assigned',
              assigned_team_key   = $2,
              assigned_for_date   = $3,
              assigned_at         = COALESCE(assigned_at, NOW()),
              assigned_scope_id   = CASE WHEN $4::int IS NULL THEN assigned_scope_id ELSE $4 END,
              updated_at          = NOW()
        WHERE id = ANY($1::int[])
          AND branch_id = $5
          AND status IN ('open', 'needs_follow_up')
          AND ${buildPlanningTaskAvailablePredicate('open_tasks', '$2', '$3')}
        RETURNING id`,
      [newlyAssignedIds, teamKey, date, scopeId, branchId],
    );
    newlyAssignedIds = assignedRows.map((row: any) => Number(row.id));

    if (performedBy != null) {
      for (const id of newlyAssignedIds) {
        const oldValue = taskRowMap.get(id)?.status ?? 'open';
        await db.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
           VALUES ($1, 'status_change', $2, NULL, $3, 'assigned')`,
          [id, performedBy, oldValue],
        );
      }
    }
  }

  // ── Step 7: refresh scope link for already-assigned eligible tasks (idempotent)
  if (scopeId != null && eligibleTaskIds.length > 0) {
    await db.query(
      `UPDATE open_tasks
          SET assigned_scope_id = $1, updated_at = NOW()
        WHERE id = ANY($2::int[])
          AND status = 'assigned'
          AND assigned_team_key = $3
          AND assigned_for_date = $4
          AND branch_id = $5
          AND (assigned_scope_id IS NULL OR assigned_scope_id <> $1)`,
      [scopeId, eligibleTaskIds, teamKey, date, branchId],
    );
  }

  // ── Step 8: release tasks no longer in scope
  if (releasedIds.length > 0) {
    const { rows: releasedRows } = await db.query(
      `UPDATE open_tasks
          SET status            = COALESCE(last_waiting_status, 'open'),
              assigned_team_key = NULL,
              assigned_for_date = NULL,
              assigned_at       = NULL,
              assigned_scope_id = NULL,
              updated_at        = NOW()
        WHERE id = ANY($1::int[])
          AND status = 'assigned'
          AND assigned_team_key = $2
          AND assigned_for_date = $3
          AND branch_id = $4
        RETURNING id`,
      [releasedIds, teamKey, date, branchId],
    );
    releasedIds = releasedRows.map((row: any) => Number(row.id));

    if (performedBy != null) {
      for (const id of releasedIds) {
        const restoredStatus = lastWaitingByAssigned.get(id) ?? 'open';
        await db.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
           VALUES ($1, 'status_change', $2, NULL, 'assigned', $3)`,
          [id, performedBy, restoredStatus],
        );
      }
    }
  }

  // ── Step 9: release only the task-to-target link. Planning reconciliation is
  // an overlay and must not manufacture a contact lifecycle transition. Keeping
  // the target row preserves the historical contact grain while a later team may
  // claim an uncommitted `new` target.
  if (releasedIds.length > 0) {
    await db.query(
      `UPDATE contact_target_open_tasks
          SET link_status = 'closed',
              updated_at = NOW()
        WHERE team_key = $1
          AND date = $2::date
          AND open_task_id = ANY($3::int[])
          AND link_status IN ('ready', 'excluded')`,
      [teamKey, date, releasedIds],
    );
  }

  return { plannedTaskIds, eligibleTaskIds, newlyAssignedIds, releasedIds };
}
