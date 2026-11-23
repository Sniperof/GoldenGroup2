import type { AuthContext, AuthorizationResult, ListAccessPlan } from '@golden-crm/shared';
import pool from '../db.js';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';
import { loadResolvedTeams, loadTeamTypeCatalog } from '../services/daySchedule.js';

/**
 * Route-assignments domain policy (engineering standard §3-3, §3-7, §4.3).
 *
 * `route_assignments` and `day_schedules` carry NO branch_id (GAP-DS-005): the
 * key is `YYYY-MM-DD_team_N`, global across branches. The branch a daily team
 * belongs to is therefore DERIVED from the team's scheduled employees
 * (the team's lead → employees.branch_id). PL-R005 guarantees a team's members
 * are all one branch, so the lead's branch is the owning branch.
 *
 * Record decisions route through `authorize()` against that owning branch:
 *  - GLOBAL  → any branch (HQ / company-wide planner)
 *  - BRANCH  → only assignments whose team belongs to the actor's branches
 *
 * When the owning branch can't be derived (no day schedule for that team yet),
 * the helpers pass `null`, so `authorize()` falls back to the actor's acting
 * branch — capability-gated but not record-isolated. This residual follows from
 * GAP-DS-005 and is documented in the route-assignments constitution.
 */
type Queryable = { query: typeof pool.query };

export interface ParsedAssignmentKey {
  date: string;
  teamKey: string;
}

const FULL_KEY_RE = /^(d{4}-d{2}-d{2})_((?:team|solo)_d+)$/;

/** Split a full `YYYY-MM-DD_team_N` assignment key into its parts. */
export function parseAssignmentKey(fullKey: string): ParsedAssignmentKey | null {
  const m = fullKey.match(FULL_KEY_RE);
  if (!m) return null;
  return { date: m[1]!, teamKey: m[2]! };
}

function toBranchId(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

/**
 * Lead employee of every team of the given days, keyed `date_teamKey`. The
 * lead is the team's owner (DEC-026 D4), found by key (DEC-026 phase 2).
 */
async function leadsByFullKey(dates: string[], db: Queryable): Promise<Map<string, number>> {
  const leads = new Map<string, number>();
  if (dates.length === 0) return leads;
  const catalog = await loadTeamTypeCatalog(db);
  for (const date of dates) {
    for (const team of await loadResolvedTeams(db, date, catalog)) {
      if (team.leadEmployeeId != null) leads.set(`${date}_${team.key}`, team.leadEmployeeId);
    }
  }
  return leads;
}

/**
 * Derive the owning branch for one team/date, or `null` if it can't be resolved
 * (no schedule, unknown key, or the lead employee has no branch).
 */
export async function resolveAssignmentOwningBranch(
  date: string,
  teamKey: string,
  db: Queryable = pool,
): Promise<number | null> {
  const empId = (await leadsByFullKey([date], db)).get(`${date}_${teamKey}`);
  if (empId == null) return null;
  const { rows: empRows } = await db.query(
    'SELECT branch_id AS "branchId" FROM employees WHERE id = $1',
    [empId],
  );
  return toBranchId(empRows[0]?.branchId);
}

/**
 * Batch variant for the list endpoint: resolve owning branch for many full
 * keys. Returns a Map keyed by full key.
 */
export async function resolveOwningBranchesForKeys(
  fullKeys: string[],
  db: Queryable = pool,
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  const dates = new Set<string>();
  for (const key of fullKeys) {
    result.set(key, null);
    const parsed = parseAssignmentKey(key);
    if (parsed) dates.add(parsed.date);
  }
  const leads = await leadsByFullKey([...dates], db);
  const neededEmpIds = new Set<number>();
  for (const key of fullKeys) {
    const empId = leads.get(key);
    if (empId != null) neededEmpIds.add(empId);
  }
  if (neededEmpIds.size === 0) return result;

  const { rows: empRows } = await db.query(
    'SELECT id, branch_id AS "branchId" FROM employees WHERE id = ANY($1::int[])',
    [[...neededEmpIds]],
  );
  const branchByEmp = new Map<number, number | null>();
  for (const row of empRows) branchByEmp.set(Number(row.id), toBranchId(row.branchId));

  for (const key of fullKeys) {
    const empId = leads.get(key);
    if (empId != null) result.set(key, branchByEmp.get(empId) ?? null);
  }
  return result;
}

export function canViewAssignment(
  context: AuthContext,
  owningBranchId: number | null,
): AuthorizationResult {
  return authorize(context, { permission: 'routes.assign.view', branchId: owningBranchId });
}

export function canManageAssignment(
  context: AuthContext,
  owningBranchId: number | null,
): AuthorizationResult {
  return authorize(context, { permission: 'routes.assign.manage', branchId: owningBranchId });
}

export function getAssignmentListAccessPlan(context: AuthContext): ListAccessPlan {
  return resolveListAccessScope(context, 'routes.assign.view');
}
