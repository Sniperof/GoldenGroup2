import pool from '../db.js';
import type { AuthContext } from '@golden-crm/shared';
import { authorize } from './authorizationService.js';
import { resolveAssignmentOwningBranch } from '../policies/routeAssignmentPolicy.js';
import { findTeam, loadResolvedTeams, type ResolvedTeam } from './daySchedule.js';

/** A scheduled team resolved by function (DEC-026): lead, field, callers. */
export type TeamSlot = ResolvedTeam;

export interface ScopeResult {
  allowed: boolean;
  reason?: string;
}

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
 * Load the teams of a day, resolved against the team types catalog. Null when
 * the day has no team.
 */
export async function loadDaySchedule(date: string): Promise<{ teams: TeamSlot[] } | null> {
  const teams = await loadResolvedTeams(pool, date);
  return teams.length > 0 ? { teams } : null;
}

/** Get a team of a day schedule by its key (team_N / solo_N). */
export function getTeamFromSchedule(
  date: string,
  schedule: { teams: TeamSlot[] } | null,
  teamKey: string,
): TeamSlot | null {
  if (!schedule) return null;
  return findTeam(schedule.teams, teamKey);
}

/** Check if an employee id sits in one of the team's caller slots. */
export function isEmployeeTelemarketerInTeam(employeeId: number, team: TeamSlot): boolean {
  return team.callerEmployeeIds.includes(employeeId);
}

/** The team lead (the supervisor of a standard team). */
export function isEmployeeSupervisorInTeam(employeeId: number, team: TeamSlot): boolean {
  return team.leadEmployeeId === employeeId;
}

export async function getTeamTelemarketerAccessEmployeeIds(
  team: TeamSlot,
  branchId: number | null,
): Promise<number[]> {
  const assignedTelemarketers = team.callerEmployeeIds;

  if (assignedTelemarketers.length > 0) {
    return assignedTelemarketers;
  }

  if (branchId == null) {
    return [];
  }

  const { rows } = await pool.query<{ employee_id: number }>(
    `SELECT e.id AS employee_id
       FROM hr_users u
       JOIN employees e ON e.id = u.employee_id
      WHERE u.branch_id = $1
        AND u.employee_id IS NOT NULL
        AND u.is_active = TRUE
        AND e.status = 'active'
        AND e.role = 'telemarketer'`,
    [branchId],
  );

  return rows.map(row => Number(row.employee_id));
}

/**
 * Determine whether the current user can access a given task list.
 *
 * Access rules (TM-4A):
 * - SYSTEM_ADMIN or GLOBAL scope: always allowed.
 * - ADMIN or BRANCH_MANAGER role (system role): allowed within their acting branch.
 * - A team lead is allowed for their own team.
 * - A telemarketing member is allowed when their employee id is in one of the
 *   team's caller slots (or in the explicit empty-team fallback pool).
 *
 * Operational membership is the subject boundary. It must not depend on the
 * denormalized employees.role label: permission + branch + team membership are
 * already the complete authorization inputs.
 */
export async function canAccessTaskList(
  authContext: { userId: number; roleId: number | null; isSuperAdmin: boolean; actingBranchId: number | null; grants: any[]; allowedBranchIds?: number[] },
  taskList: { teamKey: string; date: string; branchId: number | null },
): Promise<boolean> {
  // Super admin or GLOBAL scope: always allowed
  if (authContext.isSuperAdmin) return true;
  const hasGlobalScope = authContext.grants.some(
    (g: any) => (
      g.permission === 'telemarketing.lists.view'
      || g.permission === 'telemarketing.lists.view_device_demo'
    ) && g.scope === 'GLOBAL',
  );
  if (hasGlobalScope) return true;

  // Non-global users must access only task lists explicitly attached to their
  // acting branch. Historical null-branch lists are denied by default.
  if (taskList.branchId == null || authContext.actingBranchId == null) {
    return false;
  }
  if (taskList.branchId !== authContext.actingBranchId) return false;
  // A cross-branch operator (GLOBAL list view elsewhere) may now hold an acting
  // branch outside their assignments; that must not stand in for a BRANCH-level
  // telemarketing grant there.
  if (
    Array.isArray(authContext.allowedBranchIds)
    && !authContext.allowedBranchIds.includes(authContext.actingBranchId)
  ) {
    return false;
  }

  // Check system role (from roles.name) for ADMIN / BRANCH_MANAGER
  const systemRole = await getSystemRoleName(authContext.roleId);

  // ADMIN and BRANCH_MANAGER: allowed within their branch
  if (systemRole && BRANCH_LEVEL_ACCESS_ROLES.has(systemRole)) {
    return true;
  }

  // Resolve the subject identity used by the saved schedule.
  const employeeId = await getCurrentEmployeeId(authContext.userId);
  if (employeeId == null) return false;

  const schedule = await loadDaySchedule(taskList.date);
  if (!schedule) return false;

  const team = getTeamFromSchedule(taskList.date, schedule, taskList.teamKey);
  if (!team) return false;

  // Team lead: always allowed for their own team.
  if (isEmployeeSupervisorInTeam(employeeId, team)) return true;

  // Telemarketer: must be explicitly part of the team, or part of the branch
  // fallback pool only when the team has no assigned telemarketers.
  const accessIds = await getTeamTelemarketerAccessEmployeeIds(team, taskList.branchId);
  return accessIds.includes(employeeId);
}

/**
 * Check whether the current user is authorized to generate task lists.
 * Only SYSTEM_ADMIN, ADMIN, and BRANCH_MANAGER should be able to generate lists.
 * Telemarketers, supervisors, and customer service supervisors cannot.
 */
export async function canGenerateForTeam(
  authContext: AuthContext,
  date: string,
  teamKey: string,
): Promise<ScopeResult> {
  const owningBranchId = await resolveAssignmentOwningBranch(date, teamKey);
  if (owningBranchId == null) {
    return { allowed: false, reason: 'Team not found in schedule for this date' };
  }
  const access = authorize(authContext, {
    permission: 'telemarketing.lists.generate',
    branchId: owningBranchId,
  });
  if (!access.allowed) {
    return { allowed: false, reason: access.reason || 'Not authorized for this team branch' };
  }
  if (
    authContext.actingBranchId != null
    && authContext.actingBranchId !== owningBranchId
    && !authContext.isSuperAdmin
    && !authContext.grants.some(grant =>
      grant.permission === 'telemarketing.lists.generate' && grant.scope === 'GLOBAL')
  ) {
    return { allowed: false, reason: 'The selected team belongs to another branch' };
  }
  return { allowed: true };
}
