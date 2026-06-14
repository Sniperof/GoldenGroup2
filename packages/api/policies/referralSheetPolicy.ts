import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { authorize } from '../services/authorizationService.js';

// Canonical permission family. The legacy `referral_sheets.*` twins were retired
// (migration 280): they were defined at {GLOBAL,BRANCH} only and, via OR
// semantics, silently nullified the intended ASSIGNED scoping on these keys.
const NAME_LIST_PERMISSIONS = {
  viewList: 'candidates.name_lists.view_list',
  create: 'candidates.name_lists.create',
  edit: 'candidates.name_lists.edit',
  delete: 'candidates.name_lists.delete',
} as const;

export interface ReferralSheetPolicySubject {
  branchId: number | null;
  ownerUserId?: number | null;
  assignedHrUserId?: number | null;
}

export interface ReferralSheetListAccessPlan {
  scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED' | 'NONE';
  userId: number;
  allowedBranchIds: number[];
}

function authorizeAnyPermission(
  context: AuthContext,
  permissions: string[],
  subject: { branchId: number | null; assignedUserId?: number | null },
): AuthorizationResult {
  let lastResult: AuthorizationResult = { allowed: false, reason: 'MISSING_PERMISSION' };

  for (const permission of permissions) {
    const result = authorize(context, {
      permission,
      branchId: subject.branchId,
      assignedUserId: subject.assignedUserId,
    });

    if (result.allowed) {
      return result;
    }

    lastResult = result;
  }

  return lastResult;
}

function authorizeReferralSheetPermission(
  context: AuthContext,
  permissions: string[],
  referralSheet: ReferralSheetPolicySubject,
): AuthorizationResult {
  return authorizeAnyPermission(context, permissions, {
    branchId: referralSheet.branchId,
    assignedUserId: referralSheet.assignedHrUserId ?? null,
  });
}

export function canListReferralSheets(
  context: AuthContext,
  branchId: number | null,
): AuthorizationResult {
  return authorizeAnyPermission(context, [NAME_LIST_PERMISSIONS.viewList], {
    branchId,
  });
}

export function getReferralSheetListAccessPlan(context: AuthContext): ReferralSheetListAccessPlan {
  if (context.isSuperAdmin) {
    return {
      scope: 'GLOBAL',
      userId: context.userId,
      allowedBranchIds: context.allowedBranchIds,
    };
  }

  const grant = context.grants.find(item => item.permission === NAME_LIST_PERMISSIONS.viewList);
  if (!grant) {
    return {
      scope: 'NONE',
      userId: context.userId,
      allowedBranchIds: context.allowedBranchIds,
    };
  }

  return {
    scope: grant.scope,
    userId: context.userId,
    allowedBranchIds: context.allowedBranchIds,
  };
}

export function canViewReferralSheet(
  context: AuthContext,
  referralSheet: ReferralSheetPolicySubject,
): AuthorizationResult {
  return authorizeReferralSheetPermission(context, [NAME_LIST_PERMISSIONS.viewList], referralSheet);
}

export function canCreateReferralSheet(
  context: AuthContext,
  referralSheet: ReferralSheetPolicySubject,
): AuthorizationResult {
  return authorizeAnyPermission(context, [NAME_LIST_PERMISSIONS.create], {
    branchId: referralSheet.branchId,
  });
}

export function canEditReferralSheet(
  context: AuthContext,
  referralSheet: ReferralSheetPolicySubject,
): AuthorizationResult {
  return authorizeReferralSheetPermission(context, [NAME_LIST_PERMISSIONS.edit], referralSheet);
}

export function canDeleteReferralSheet(
  context: AuthContext,
  referralSheet: ReferralSheetPolicySubject,
): AuthorizationResult {
  return authorizeReferralSheetPermission(context, [NAME_LIST_PERMISSIONS.delete], referralSheet);
}
