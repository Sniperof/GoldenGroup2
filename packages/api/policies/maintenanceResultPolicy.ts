import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { authorize } from '../services/authorizationService.js';
import { getVisitTeamEmployeeIds, type FieldVisitAccessSubject } from './fieldVisitPolicy.js';

/**
 * Reading a maintenance (emergency / periodic) result: the result itself, its
 * parts, payments, installments, and the device's technical history.
 *
 * Whoever may RECORD the result may read it back: before, reading needed
 * marketing_visits.view while saving needed marketing_visits.update_result, so a
 * supervisor holding only the second could save parts and never see them
 * (2026-11-04). Any of these keys opens the read:
 */
export const MAINTENANCE_RESULT_READ_KEYS = [
  'marketing_visits.view',
  'marketing_visits.update_result',
  'tasks.results.record',
] as const;

export interface MaintenanceResultSubject {
  /** Branch of the task (or of the contract, for device history). */
  branchId: number | null;
  /** The visits that carry the task (or the contract's device). */
  visits: FieldVisitAccessSubject[];
}

/**
 * Before, the read endpoints checked the key only: any holder — ASSIGNED
 * included — read any task's result and payment amounts company-wide by id.
 * Now the record's branch must be in the grant's scope, and an ASSIGNED grant
 * reads only a task whose visit team includes the actor (the «my visits» team).
 */
export function canReadMaintenanceResult(
  context: AuthContext,
  subject: MaintenanceResultSubject,
  actorEmployeeId: number | null,
): AuthorizationResult {
  if (context.isSuperAdmin) return { allowed: true, reason: 'SUPER_ADMIN' };

  let lastDenied: AuthorizationResult = { allowed: false, reason: 'MISSING_PERMISSION' };
  for (const permission of MAINTENANCE_RESULT_READ_KEYS) {
    const grant = context.grants.find(item => item.permission === permission);
    if (!grant) continue;

    const branchResult = authorize(context, { permission, branchId: subject.branchId });
    if (!branchResult.allowed) {
      lastDenied = branchResult;
      continue;
    }
    if (grant.scope !== 'ASSIGNED') return branchResult;

    const onTeam = actorEmployeeId != null
      && subject.visits.some(visit => getVisitTeamEmployeeIds(visit).includes(actorEmployeeId));
    if (onTeam) return branchResult;
    lastDenied = { allowed: false, reason: 'ASSIGNMENT_FORBIDDEN', grant };
  }
  return lastDenied;
}
