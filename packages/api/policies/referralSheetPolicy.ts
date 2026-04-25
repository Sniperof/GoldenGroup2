import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { authorize } from '../services/authorizationService.js';

export interface ReferralSheetPolicySubject {
  branchId: number | null;
  ownerUserId?: number | null;
  assignedHrUserId?: number | null;
}

function authorizeReferralSheetPermission(
  context: AuthContext,
  permission: string,
  referralSheet: ReferralSheetPolicySubject,
): AuthorizationResult {
  return authorize(context, {
    permission,
    branchId: referralSheet.branchId,
    assignedUserId: referralSheet.assignedHrUserId ?? null,
  });
}

export function canListReferralSheets(
  context: AuthContext,
  branchId: number | null,
): AuthorizationResult {
  return authorize(context, {
    permission: 'referral_sheets.view_list',
    branchId,
  });
}

export function canViewReferralSheet(
  context: AuthContext,
  referralSheet: ReferralSheetPolicySubject,
): AuthorizationResult {
  return authorizeReferralSheetPermission(context, 'referral_sheets.view_list', referralSheet);
}

export function canCreateReferralSheet(
  context: AuthContext,
  referralSheet: ReferralSheetPolicySubject,
): AuthorizationResult {
  return authorize(context, {
    permission: 'referral_sheets.create',
    branchId: referralSheet.branchId,
  });
}

export function canEditReferralSheet(
  context: AuthContext,
  referralSheet: ReferralSheetPolicySubject,
): AuthorizationResult {
  return authorizeReferralSheetPermission(context, 'referral_sheets.edit', referralSheet);
}

export function canDeleteReferralSheet(
  context: AuthContext,
  referralSheet: ReferralSheetPolicySubject,
): AuthorizationResult {
  return authorizeReferralSheetPermission(context, 'referral_sheets.delete', referralSheet);
}
