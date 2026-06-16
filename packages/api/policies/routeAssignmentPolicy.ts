import type { AuthContext, AuthorizationResult, ListAccessPlan } from '@golden-crm/shared';
import pool from '../db.js';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';

/**
 * Route-assignments domain policy (engineering standard §3-3, §3-7, §4.3).
 *
 * `route_assignments` and `day_schedules` carry NO branch_id (GAP-DS-005): the
 * key is `YYYY-MM-DD_team_N`, global across branches. The branch a daily team
 * belongs to is therefore DERIVED from the team's scheduled employees
 * (day_schedules.teams[N] / solos[N] → employees.branch_id). PL-R005 guarantees
 * a team's members are all one branch, so the supervisor/technician's branch is
 * the owning branch.
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
  type: 'team' | 'solo';
  index: number;
}

const FULL_KEY_RE = /^(\d{4}-\d{2}-\d{2})_((?:team|solo)_(\d+))$/;
const TEAM_KEY_RE = /^(team|solo)_(\d+)$/;

/** Split a full `YYYY-MM-DD_team_N` assignment key into its parts. */
export function parseAssignmentKey(fullKey: string): ParsedAssignmentKey | null {
  const m = fullKey.match(FULL_KEY_RE);
  if (!m) return null;
  return { date: m[1], teamKey: m[2], type: m[2].startsWith('solo') ? 'solo' : 'team', index: Number(m[3]) };
}

function parseTeamKey(teamKey: string): { type: 'team' | 'solo'; index: number } | null {
  const m = teamKey.match(TEAM_KEY_RE);
  if (!m) return null;
  return { type: m[1] as 'team' | 'solo', index: Number(m[2]) };
}

function ownerEmployeeId(type: 'team' | 'solo', slot: unknown): number | null {
  if (!slot || typeof slot !== 'object') return null;
  const s = slot as { supervisor?: unknown; technician?: unknown };
  const candidate = type === 'team' ? (s.supervisor ?? s.technician) : s.technician;
  return Number.isInteger(candidate) && (candidate as number) > 0 ? (candidate as number) : null;
}

function toBranchId(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

/**
 * Derive the owning branch for one team/date, or `null` if it can't be resolved
 * (no schedule, slot out of range, or the slot employee has no branch).
 */
export async function resolveAssignmentOwningBranch(
  date: string,
  teamKey: string,
  db: Queryable = pool,
): Promise<number | null> {
  const parsed = parseTeamKey(teamKey);
  if (!parsed) return null;

  const { rows } = await db.query('SELECT teams, solos FROM day_schedules WHERE date = $1', [date]);
  if (!rows[0]) return null;

  const slots = parsed.type === 'team' ? rows[0].teams : rows[0].solos;
  if (!Array.isArray(slots)) return null;

  const empId = ownerEmployeeId(parsed.type, slots[parsed.index]);
  if (empId == null) return null;

  const { rows: empRows } = await db.query(
    'SELECT branch_id AS "branchId" FROM employees WHERE id = $1',
    [empId],
  );
  return toBranchId(empRows[0]?.branchId);
}

/**
 * Batch variant for the list endpoint: resolve owning branch for many full
 * keys with three bulk queries instead of N+1. Returns a Map keyed by full key.
 */
export async function resolveOwningBranchesForKeys(
  fullKeys: string[],
  db: Queryable = pool,
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  const parsedByKey = new Map<string, ParsedAssignmentKey>();
  for (const key of fullKeys) {
    const parsed = parseAssignmentKey(key);
    if (parsed) parsedByKey.set(key, parsed);
    result.set(key, null);
  }
  if (parsedByKey.size === 0) return result;

  const dates = [...new Set([...parsedByKey.values()].map(p => p.date))];
  const { rows: scheduleRows } = await db.query(
    'SELECT date, teams, solos FROM day_schedules WHERE date = ANY($1::text[])',
    [dates],
  );
  const schedulesByDate = new Map<string, { teams: unknown; solos: unknown }>();
  for (const row of scheduleRows) {
    schedulesByDate.set(String(row.date), { teams: row.teams, solos: row.solos });
  }

  const empByKey = new Map<string, number>();
  const neededEmpIds = new Set<number>();
  for (const [key, parsed] of parsedByKey) {
    const schedule = schedulesByDate.get(parsed.date);
    if (!schedule) continue;
    const slots = parsed.type === 'team' ? schedule.teams : schedule.solos;
    if (!Array.isArray(slots)) continue;
    const empId = ownerEmployeeId(parsed.type, slots[parsed.index]);
    if (empId == null) continue;
    empByKey.set(key, empId);
    neededEmpIds.add(empId);
  }
  if (neededEmpIds.size === 0) return result;

  const { rows: empRows } = await db.query(
    'SELECT id, branch_id AS "branchId" FROM employees WHERE id = ANY($1::int[])',
    [[...neededEmpIds]],
  );
  const branchByEmp = new Map<number, number | null>();
  for (const row of empRows) {
    branchByEmp.set(Number(row.id), toBranchId(row.branchId));
  }

  for (const [key, empId] of empByKey) {
    result.set(key, branchByEmp.get(empId) ?? null);
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
