import pool from '../db.js';

export interface TeamPlanningScope {
  supervisorEmployeeId: number | null;
  technicianEmployeeId: number | null;
  supervisorHrUserId: number | null;
  technicianHrUserId: number | null;
  // hr_users linked to branch-level (company) accounts: employee_id IS NULL, branch_id matches
  companyHrUserIds: number[];
  // union of supervisor + technician + company hr_user IDs used for explicit assignment matching
  actorHrUserIds: number[];
  reason: string | null;
}

/**
 * Resolves the set of hr_user IDs eligible to act as customer-assignment owners
 * for a team. Supports three assignment types:
 *   1. Supervisor assignment  — personal hr_user linked to the supervisor employee
 *   2. Technician assignment  — personal hr_user linked to the technician employee
 *   3. Company assignment     — branch-level hr_users (employee_id IS NULL, branch_id matches)
 *
 * actorHrUserIds is the union of all three and is used for explicit assignment matching.
 * Unassigned branch-owned records are handled separately by the planning SQL layer.
 * If branchId is omitted, company assignment lookup is skipped.
 */
export async function resolveTeamPlanningScope(team: {
  supervisor: number | null | undefined;
  technician: number | null | undefined;
  branchId?: number | null;
}): Promise<TeamPlanningScope> {
  const supervisorEmployeeId = team.supervisor != null ? Number(team.supervisor) : null;
  const technicianEmployeeId = team.technician != null ? Number(team.technician) : null;
  const branchId = team.branchId != null ? Number(team.branchId) : null;

  const employeeIds = [supervisorEmployeeId, technicianEmployeeId].filter((id): id is number => id != null);

  // Fetch company hr_user IDs in parallel with personal lookup when branchId is available
  const companyHrUserIdsPromise: Promise<number[]> =
    branchId != null
      ? pool
          .query<{ id: number }>(
            `SELECT id FROM hr_users WHERE employee_id IS NULL AND is_active = TRUE AND branch_id = $1`,
            [branchId],
          )
          .then(r => r.rows.map(row => Number(row.id)))
      : Promise.resolve([]);

  if (employeeIds.length === 0) {
    const companyHrUserIds = await companyHrUserIdsPromise;
    const actorHrUserIds = companyHrUserIds;
    return {
      supervisorEmployeeId,
      technicianEmployeeId,
      supervisorHrUserId: null,
      technicianHrUserId: null,
      companyHrUserIds,
      actorHrUserIds,
      reason:
        actorHrUserIds.length === 0
          ? 'TEAM_HAS_NO_SUPERVISOR_OR_TECHNICIAN'
          : 'TEAM_HAS_NO_SUPERVISOR_OR_TECHNICIAN_COMPANY_ONLY',
    };
  }

  const [{ rows }, companyHrUserIds] = await Promise.all([
    pool.query<{ id: number; employee_id: number }>(
      `SELECT id, employee_id FROM hr_users WHERE employee_id = ANY($1::int[]) AND is_active = TRUE`,
      [employeeIds],
    ),
    companyHrUserIdsPromise,
  ]);

  const hrUserByEmployee = new Map<number, number>();
  rows.forEach(row => {
    hrUserByEmployee.set(Number(row.employee_id), Number(row.id));
  });

  const supervisorHrUserId = supervisorEmployeeId != null ? (hrUserByEmployee.get(supervisorEmployeeId) ?? null) : null;
  const technicianHrUserId = technicianEmployeeId != null ? (hrUserByEmployee.get(technicianEmployeeId) ?? null) : null;

  const actorHrUserIds = [supervisorHrUserId, technicianHrUserId, ...companyHrUserIds].filter(
    (id): id is number => id != null,
  );

  return {
    supervisorEmployeeId,
    technicianEmployeeId,
    supervisorHrUserId,
    technicianHrUserId,
    companyHrUserIds,
    actorHrUserIds,
    reason: actorHrUserIds.length === 0 ? 'TEAM_ACTORS_HAVE_NO_ACTIVE_HR_USER' : null,
  };
}
