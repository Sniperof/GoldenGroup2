import pool from '../db.js';

export interface TeamPlanningScope {
  supervisorEmployeeId: number | null;
  technicianEmployeeId: number | null;
  supervisorHrUserId: number | null;
  technicianHrUserId: number | null;
  actorHrUserIds: number[];
  reason: string | null;
}

/**
 * Resolves the set of hr_user IDs eligible to act as customer-assignment owners
 * for a team. Includes the supervisor's and technician's active hr_users.
 * If one actor has no active hr_user the other still counts.
 */
export async function resolveTeamPlanningScope(team: {
  supervisor: number | null | undefined;
  technician: number | null | undefined;
}): Promise<TeamPlanningScope> {
  const supervisorEmployeeId = team.supervisor != null ? Number(team.supervisor) : null;
  const technicianEmployeeId = team.technician != null ? Number(team.technician) : null;

  const employeeIds = [supervisorEmployeeId, technicianEmployeeId].filter((id): id is number => id != null);

  if (employeeIds.length === 0) {
    return {
      supervisorEmployeeId,
      technicianEmployeeId,
      supervisorHrUserId: null,
      technicianHrUserId: null,
      actorHrUserIds: [],
      reason: 'TEAM_HAS_NO_SUPERVISOR_OR_TECHNICIAN',
    };
  }

  const { rows } = await pool.query<{ id: number; employee_id: number }>(
    `SELECT id, employee_id FROM hr_users WHERE employee_id = ANY($1::int[]) AND is_active = TRUE`,
    [employeeIds],
  );

  const hrUserByEmployee = new Map<number, number>();
  rows.forEach(row => {
    hrUserByEmployee.set(Number(row.employee_id), Number(row.id));
  });

  const supervisorHrUserId = supervisorEmployeeId != null ? (hrUserByEmployee.get(supervisorEmployeeId) ?? null) : null;
  const technicianHrUserId = technicianEmployeeId != null ? (hrUserByEmployee.get(technicianEmployeeId) ?? null) : null;

  const actorHrUserIds = [supervisorHrUserId, technicianHrUserId].filter((id): id is number => id != null);

  return {
    supervisorEmployeeId,
    technicianEmployeeId,
    supervisorHrUserId,
    technicianHrUserId,
    actorHrUserIds,
    reason: actorHrUserIds.length === 0 ? 'TEAM_ACTORS_HAVE_NO_ACTIVE_HR_USER' : null,
  };
}
