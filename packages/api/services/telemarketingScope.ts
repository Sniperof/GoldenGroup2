import pool from '../db.js';

export interface TeamSlot {
  supervisor: number | null;
  technician: number | null;
  telemarketers?: number[];
  trainee?: number | null;
}

export interface ScopeResult {
  allowed: boolean;
  reason?: string;
}

const GENERATE_ALLOWED_SYSTEM_ROLES = new Set(['SYSTEM_ADMIN', 'ADMIN', 'BRANCH_MANAGER']);

function normalizeSystemRoleName(roleName: string | null | undefined): string | null {
  if (typeof roleName !== 'string') return null;
  const normalized = roleName.trim().replace(/[\s-]+/g, '_').toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Roles that are allowed branch-level access to telemarketing task lists.
 * Only these roles (plus SYSTEM_ADMIN/global) can see all task lists within
 * their acting branch. Other roles (including CUSTOMER_SERVICE_SUPERVISOR,
 * TECHNICIAN, SUPERVISOR) are not granted branch-level telemarketing access.
 *
 * Values are uppercase to match the `roles.name` column (system roles).
 */
export const BRANCH_LEVEL_ACCESS_ROLES = new Set(['ADMIN', 'BRANCH_MANAGER']);

/**
 * Resolve a role_id to the system role name (e.g. 'ADMIN', 'BRANCH_MANAGER').
 * Returns null if roleId is null or the role is not found.
 */
export async function getSystemRoleName(roleId: number | null): Promise<string | null> {
  if (roleId == null) return null;
  const { rows } = await pool.query(
    `SELECT name FROM roles WHERE id = $1`,
    [roleId],
  );
  return normalizeSystemRoleName(rows[0]?.name ?? null);
}

/**
 * Resolve hr_users.id to employees.id for the current user.
 * Returns null if the user has no linked employee record.
 */
export async function getCurrentEmployeeId(hrUserId: number): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT employee_id FROM hr_users WHERE id = $1 AND is_active = TRUE`,
    [hrUserId],
  );
  const employeeId = rows[0]?.employee_id;
  return Number.isInteger(employeeId) && employeeId > 0 ? employeeId : null;
}

/**
 * Get the employee operational role (lowercase: 'supervisor', 'technician',
 * 'telemarketer', 'trainee') from the employees table via hr_users linkage.
 * Returns null if the user has no linked employee or the role is not set.
 */
export async function getCurrentEmployeeRole(hrUserId: number): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT e.role FROM hr_users h JOIN employees e ON e.id = h.employee_id WHERE h.id = $1 AND h.is_active = TRUE`,
    [hrUserId],
  );
  return rows[0]?.role ?? null;
}

/**
 * Parse teamKey like "team_0" or "team_2" into a zero-based team index.
 */
export function parseTeamKeyIndex(teamKey: string): number | null {
  const match = teamKey.match(/^team_(\d+)$/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * Load day_schedules row for a given date.
 * Returns the raw row with teams (JSONB) and solos (JSONB).
 */
export async function loadDaySchedule(date: string): Promise<{ teams: TeamSlot[]; solos: any[] } | null> {
  const { rows } = await pool.query(
    `SELECT teams, solos FROM day_schedules WHERE date = $1`,
    [date],
  );
  if (!rows[0]) return null;
  return {
    teams: Array.isArray(rows[0].teams) ? rows[0].teams : [],
    solos: Array.isArray(rows[0].solos) ? rows[0].solos : [],
  };
}

/**
 * Get the team object from a day schedule given a teamKey like "team_0".
 */
export function getTeamFromSchedule(
  date: string,
  schedule: { teams: TeamSlot[] } | null,
  teamKey: string,
): TeamSlot | null {
  if (!schedule) return null;
  const idx = parseTeamKeyIndex(teamKey);
  if (idx == null || idx < 0 || idx >= schedule.teams.length) return null;
  return schedule.teams[idx] ?? null;
}

/**
 * Check if an employee id is a telemarketer member of a team.
 */
export function isEmployeeTelemarketerInTeam(employeeId: number, team: TeamSlot): boolean {
  return Array.isArray(team.telemarketers) && team.telemarketers.includes(employeeId);
}

/**
 * Determine whether the current user can access a given task list.
 *
 * Access rules (TM-4A):
 * - SYSTEM_ADMIN or GLOBAL scope: always allowed.
 * - ADMIN or BRANCH_MANAGER role (system role): allowed within their acting branch.
 * - Employees with employees.role = 'telemarketer': allowed ONLY if their
 *   employee id is in team.telemarketers[] for the task list's date/teamKey.
 * - All other roles (CUSTOMER_SERVICE_SUPERVISOR, TECHNICIAN, SUPERVISOR, etc.):
 *   denied by default.
 */
export async function canAccessTaskList(
  authContext: { userId: number; roleId: number | null; isSuperAdmin: boolean; actingBranchId: number | null; grants: any[] },
  taskList: { teamKey: string; date: string; branchId: number | null },
): Promise<boolean> {
  // Super admin or GLOBAL scope: always allowed
  if (authContext.isSuperAdmin) return true;
  const hasGlobalScope = authContext.grants.some(
    (g: any) => g.permission === 'telemarketing.lists.view' && g.scope === 'GLOBAL',
  );
  if (hasGlobalScope) return true;

  // Non-global users must access only task lists explicitly attached to their
  // acting branch. Historical null-branch lists are denied by default.
  if (taskList.branchId == null || authContext.actingBranchId == null) {
    return false;
  }
  if (taskList.branchId !== authContext.actingBranchId) return false;

  // Check system role (from roles.name) for ADMIN / BRANCH_MANAGER
  const systemRole = await getSystemRoleName(authContext.roleId);

  // ADMIN and BRANCH_MANAGER: allowed within their branch
  if (systemRole && BRANCH_LEVEL_ACCESS_ROLES.has(systemRole)) {
    return true;
  }

  // Check employee operational role for telemarketer team membership
  const employeeId = await getCurrentEmployeeId(authContext.userId);
  const employeeRole = await getCurrentEmployeeRole(authContext.userId);

  // Telemarketer: must be in team.telemarketers[]
  if (employeeRole === 'telemarketer' && employeeId != null) {
    const schedule = await loadDaySchedule(taskList.date);
    if (!schedule) return false;
    const team = getTeamFromSchedule(taskList.date, schedule, taskList.teamKey);
    if (!team) return false;
    return isEmployeeTelemarketerInTeam(employeeId, team);
  }

  // All other roles: denied by default
  // This includes CUSTOMER_SERVICE_SUPERVISOR, TECHNICIAN, SUPERVISOR, etc.
  return false;
}

/**
 * Check whether the current user is authorized to generate task lists.
 * Only SYSTEM_ADMIN, ADMIN, and BRANCH_MANAGER should be able to generate lists.
 * Telemarketers, supervisors, and customer service supervisors cannot.
 */
export async function canGenerateForTeam(
  authContext: { userId: number; roleId: number | null; isSuperAdmin: boolean; actingBranchId: number | null; grants: any[] },
  date: string,
  teamKey: string,
): Promise<ScopeResult> {
  if (authContext.isSuperAdmin) return { allowed: true };
  const hasGlobalScope = authContext.grants.some(
    (g: any) => g.permission === 'telemarketing.lists.generate' && g.scope === 'GLOBAL',
  );
  if (hasGlobalScope) return { allowed: true };

  // Branch scope: acting branch must be set
  if (authContext.actingBranchId == null) {
    return { allowed: false, reason: 'Branch context required' };
  }

  // Check system role for ADMIN / BRANCH_MANAGER
  const systemRole = await getSystemRoleName(authContext.roleId);

  // Only ADMIN and BRANCH_MANAGER can generate
  if (systemRole && GENERATE_ALLOWED_SYSTEM_ROLES.has(systemRole)) {
    // Verify the team exists in the schedule
    const schedule = await loadDaySchedule(date);
    if (!schedule) return { allowed: false, reason: 'No schedule found for this date' };
    const team = getTeamFromSchedule(date, schedule, teamKey);
    if (!team) return { allowed: false, reason: 'Team not found in schedule for this date' };
    return { allowed: true };
  }

  // Telemarketers, supervisors, technicians, customer service supervisors: denied
  return { allowed: false, reason: 'Only branch managers and admins can generate task lists' };
}
