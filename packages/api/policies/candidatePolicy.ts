import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { authorize } from '../services/authorizationService.js';

export interface CandidatePolicySubject {
  branchId: number | null;
  ownerUserId?: number | null;
}

function authorizeCandidatePermission(
  context: AuthContext,
  permission: string,
  candidate: CandidatePolicySubject,
): AuthorizationResult {
  return authorize(context, {
    permission,
    branchId: candidate.branchId,
    assignedUserId: candidate.ownerUserId ?? null,
  });
}

function authorizeBranchOnlyCandidatePermission(
  context: AuthContext,
  permission: string,
  candidate: CandidatePolicySubject,
): AuthorizationResult {
  return authorize(context, {
    permission,
    branchId: candidate.branchId,
  });
}

export function canListCandidates(context: AuthContext, branchId: number | null): AuthorizationResult {
  return authorize(context, {
    permission: 'candidates.view_list',
    branchId,
  });
}

export function canViewCandidate(
  context: AuthContext,
  candidate: CandidatePolicySubject,
): AuthorizationResult {
  return authorizeCandidatePermission(context, 'candidates.view_list', candidate);
}

export function canCreateCandidate(
  context: AuthContext,
  candidate: CandidatePolicySubject,
): AuthorizationResult {
  return authorizeBranchOnlyCandidatePermission(context, 'candidates.create', candidate);
}

export function canEditCandidate(
  context: AuthContext,
  candidate: CandidatePolicySubject,
): AuthorizationResult {
  return authorizeCandidatePermission(context, 'candidates.edit', candidate);
}

export function canDeleteCandidate(
  context: AuthContext,
  candidate: CandidatePolicySubject,
): AuthorizationResult {
  return authorizeCandidatePermission(context, 'candidates.delete', candidate);
}
