import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { canEditFieldVisit, type FieldVisitAccessSubject } from './fieldVisitPolicy.js';
import { authorize } from '../services/authorizationService.js';

export interface ContractCreationVisitSubject extends FieldVisitAccessSubject {
  team_responsible_user_id?: number | null;
}

/**
 * A visit is a contextual subject for contract creation; it does not transfer
 * ownership of the client or widen the actor's general client-list scope.
 *
 * The actor must first be able to create a contract in the visit branch. The
 * visit context is then available to the effective assigned supervisor, or to
 * a user who can manage that visit explicitly.
 */
export function canCreateContractFromVisit(
  context: AuthContext,
  visit: ContractCreationVisitSubject,
  actorEmployeeId: number | null,
): AuthorizationResult {
  const createResult = authorize(context, {
    permission: 'contracts.create',
    branchId: visit.branch_id,
  });
  if (!createResult.allowed) return createResult;

  const effectiveSupervisorId = getEffectiveVisitSupervisorEmployeeId(visit);

  if (actorEmployeeId != null && actorEmployeeId === effectiveSupervisorId) {
    return createResult;
  }

  const managementResult = canEditFieldVisit(
    context,
    visit.branch_id,
    visit.team_responsible_user_id ?? null,
  );
  if (managementResult.allowed) return createResult;

  return {
    allowed: false,
    reason: 'ASSIGNMENT_FORBIDDEN',
    grant: createResult.grant,
  };
}

export function getEffectiveVisitSupervisorEmployeeId(
  visit: ContractCreationVisitSubject,
): number | null {
  return toPositiveInteger(visit.reassigned_supervisor_id)
    ?? readTeamEmployeeId(visit.team_snapshot, 'supervisorEmployeeId');
}

function readTeamEmployeeId(snapshot: unknown, key: string): number | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return toPositiveInteger((snapshot as Record<string, unknown>)[key]);
}

function toPositiveInteger(value: unknown): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return Number.isInteger(numeric) && (numeric as number) > 0 ? (numeric as number) : null;
}
