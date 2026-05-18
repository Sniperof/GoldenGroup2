import pool from '../db.js';
import { getPlanningWorkScope } from './planningMarketingTargets.js';

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
  const { date, teamKey, branchId, scopeId = null, performedBy = null } = params;
  // FIX-2: use provided client or fall back to pool
  const db = params.db ?? pool;

  // ── Step 1: eligible task IDs from work scope (N-window + ownership + zone already applied)
  // FIX-3: do NOT expand to all client tasks — use only what workScope approved.
  // Note: getPlanningWorkScope always uses pool (it must read the just-saved route_assignment),
  // so we call it before entering any transaction block in the caller.
  const workScope = await getPlanningWorkScope({ date, teamKey, branchId });
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
        AND assigned_for_date = $2`,
    [teamKey, date],
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
        WHERE id = ANY($1::int[])`,
      [plannedTaskIds],
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
  const newlyAssignedIds = eligibleTaskIds.filter(id => {
    const row = taskRowMap.get(id);
    return !currentlyAssignedSet.has(id) && row != null && WAITING_STATES.has(row.status);
  });
  // released = currently assigned for this team but no longer eligible
  const releasedIds = currentlyAssignedIds.filter(id => !eligibleTaskSet.has(id));

  // ── Step 6: write newly assigned
  if (newlyAssignedIds.length > 0) {
    await db.query(
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
          AND status IN ('open', 'needs_follow_up')`,
      [newlyAssignedIds, teamKey, date, scopeId],
    );

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
          AND (assigned_scope_id IS NULL OR assigned_scope_id <> $1)`,
      [scopeId, eligibleTaskIds],
    );
  }

  // ── Step 8: release tasks no longer in scope
  if (releasedIds.length > 0) {
    await db.query(
      `UPDATE open_tasks
          SET status            = COALESCE(last_waiting_status, 'open'),
              assigned_team_key = NULL,
              assigned_for_date = NULL,
              assigned_at       = NULL,
              assigned_scope_id = NULL,
              updated_at        = NOW()
        WHERE id = ANY($1::int[])
          AND status = 'assigned'`,
      [releasedIds],
    );

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

  return { plannedTaskIds, eligibleTaskIds, newlyAssignedIds, releasedIds };
}
