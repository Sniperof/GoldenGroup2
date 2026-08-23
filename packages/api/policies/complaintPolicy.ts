import type { AuthContext, AuthorizationResult, ListAccessPlan } from '@golden-crm/shared';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';

export interface ComplaintSubject {
  handlingBranchId: number | null;
  assignedUserId: number | null;
}

export function getComplaintListAccessPlan(context: AuthContext): ListAccessPlan {
  return resolveListAccessScope(context, 'complaints.view_list');
}

export function canAccessComplaint(
  context: AuthContext,
  permission: string,
  subject: ComplaintSubject,
): AuthorizationResult {
  const grant = context.grants.find(item => item.permission === permission);
  // A complaint without a handling branch belongs to the central queue. The
  // generic authorizer may fall back to actingBranchId when branchId is null;
  // that is useful for create/list gates but would leak an unassigned central
  // record to BRANCH/ASSIGNED viewers. Record authorization must fail closed.
  if (!context.isSuperAdmin && subject.handlingBranchId == null && grant?.scope !== 'GLOBAL') {
    return { allowed: false, reason: grant ? 'MISSING_BRANCH_CONTEXT' : 'MISSING_PERMISSION', ...(grant ? { grant } : {}) };
  }
  return authorize(context, {
    permission,
    branchId: subject.handlingBranchId,
    assignedUserId: subject.assignedUserId,
  });
}
