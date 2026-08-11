import type { AuthContext, AuthorizationResult, ListAccessPlan } from '@golden-crm/shared';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';

export const MY_VISITS_PERMISSION = 'field_visits.my_visits.view';

export interface FieldVisitAccessSubject {
  branch_id: number | null;
  team_snapshot?: unknown;
  reassigned_supervisor_id?: unknown;
  reassigned_technician_id?: unknown;
  reassigned_trainee_id?: unknown;
}

/**
 * Field-visits domain policy (engineering standard §4.3, §6).
 *
 * The management surface supports GLOBAL/BRANCH only. ASSIGNED belongs to the
 * dedicated "my visits" permission and is never interpreted as a narrower form
 * of field_visits.view/edit.
 */
export function canViewFieldVisit(
  context: AuthContext,
  branchId: number | null,
): AuthorizationResult {
  const invalidAssignedGrant = rejectAssignedManagementGrant(context, 'field_visits.view');
  if (invalidAssignedGrant) return invalidAssignedGrant;
  return authorize(context, { permission: 'field_visits.view', branchId });
}

export function canEditFieldVisit(
  context: AuthContext,
  branchId: number | null,
  assignedUserId?: number | null,
): AuthorizationResult {
  const invalidAssignedGrant = rejectAssignedManagementGrant(context, 'field_visits.edit');
  if (invalidAssignedGrant) return invalidAssignedGrant;
  return authorize(context, { permission: 'field_visits.edit', branchId, assignedUserId });
}

export function canViewOwnFieldVisit(
  context: AuthContext,
  visit: FieldVisitAccessSubject,
  actorEmployeeId: number | null,
): AuthorizationResult {
  const permissionResult = authorize(context, {
    permission: MY_VISITS_PERMISSION,
    branchId: visit.branch_id,
  });
  if (!permissionResult.allowed) return permissionResult;

  if (
    actorEmployeeId == null
    || !getVisitTeamEmployeeIds(visit).includes(actorEmployeeId)
  ) {
    return {
      allowed: false,
      reason: 'ASSIGNMENT_FORBIDDEN',
      grant: permissionResult.grant,
    };
  }

  return permissionResult;
}

export function canViewFieldVisitOrOwn(
  context: AuthContext,
  visit: FieldVisitAccessSubject,
  actorEmployeeId: number | null,
): AuthorizationResult {
  const managementResult = canViewFieldVisit(context, visit.branch_id);
  if (managementResult.allowed) return managementResult;
  return canViewOwnFieldVisit(context, visit, actorEmployeeId);
}

export function getFieldVisitListAccessPlan(context: AuthContext): ListAccessPlan {
  const plan = resolveListAccessScope(context, 'field_visits.view');
  if (plan.scope !== 'ASSIGNED') return plan;

  return {
    scope: 'NONE',
    userId: plan.userId,
    allowedBranchIds: [],
  };
}

function rejectAssignedManagementGrant(
  context: AuthContext,
  permission: 'field_visits.view' | 'field_visits.edit',
): AuthorizationResult | null {
  if (context.isSuperAdmin) return null;
  const grant = context.grants.find(item => item.permission === permission);
  if (grant?.scope !== 'ASSIGNED') return null;
  return { allowed: false, reason: 'ASSIGNMENT_FORBIDDEN', grant };
}

function getVisitTeamEmployeeIds(visit: FieldVisitAccessSubject): number[] {
  const ids = [
    toPositiveInteger(visit.reassigned_supervisor_id)
      ?? readTeamEmployeeId(visit.team_snapshot, 'supervisorEmployeeId'),
    toPositiveInteger(visit.reassigned_technician_id)
      ?? readTeamEmployeeId(visit.team_snapshot, 'technicianEmployeeId'),
    toPositiveInteger(visit.reassigned_trainee_id)
      ?? readTeamEmployeeId(visit.team_snapshot, 'traineeEmployeeId'),
  ].filter((id): id is number => id != null);

  return [...new Set(ids)];
}

function readTeamEmployeeId(snapshot: unknown, key: string): number | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return toPositiveInteger((snapshot as Record<string, unknown>)[key]);
}

function toPositiveInteger(value: unknown): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return Number.isInteger(numeric) && (numeric as number) > 0 ? (numeric as number) : null;
}
