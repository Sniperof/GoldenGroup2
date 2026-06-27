import type { AuthContext } from '@golden-crm/shared';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';

export interface GiftSubject {
  sourceBranchId: number | null;
  responsibleBranchId: number | null;
  assignedUserId?: number | null;
  beneficiaryAssignedToCurrentUser?: boolean;
  beneficiaryEmployeeId?: number | null;
}

function branchIdForGift(subject: GiftSubject): number | null {
  return subject.responsibleBranchId ?? subject.sourceBranchId ?? null;
}

function assignedUserForGift(
  context: AuthContext,
  subject: GiftSubject,
  currentEmployeeId?: number | null,
): number | null {
  if (subject.beneficiaryAssignedToCurrentUser) return context.userId;
  if (subject.assignedUserId === context.userId) return context.userId;
  if (
    currentEmployeeId != null &&
    subject.beneficiaryEmployeeId != null &&
    subject.beneficiaryEmployeeId === currentEmployeeId
  ) {
    return context.userId;
  }
  return null;
}

export function canAccessGift(
  context: AuthContext,
  permission: string,
  subject: GiftSubject,
  currentEmployeeId?: number | null,
) {
  return authorize(context, {
    permission,
    branchId: branchIdForGift(subject),
    assignedUserId: assignedUserForGift(context, subject, currentEmployeeId),
  }).allowed;
}

export function getGiftListAccessPlan(context: AuthContext, permission: string) {
  return resolveListAccessScope(context, permission);
}
