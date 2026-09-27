import type { AuthContext } from '@golden-crm/shared';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';

export interface GiftSubject {
  sourceBranchId: number | null;
  responsibleBranchId: number | null;
  assignedUserId?: number | null;
  beneficiaryAssignedToCurrentUser?: boolean;
  beneficiaryEmployeeId?: number | null;
  /** The gift's contract was created, owned (sale owner) or closed by the
   *  current user — see giftContractLinkSql. A promise made in "my" contract
   *  is "mine" under ASSIGNED; OP promotion wipes client_assignments, so the
   *  beneficiary link alone lost it the moment the contract was approved. */
  contractLinkedToCurrentUser?: boolean;
}

/**
 * SQL predicate (alias `gr` = gift_records) for {@link GiftSubject.contractLinkedToCurrentUser}.
 * contracts.created_by / closing_employee_id reference hr_users;
 * contracts.sale_owner_id references employees.
 */
export function giftContractLinkSql(userParam: string, employeeParam: string): string {
  return `EXISTS (
    SELECT 1 FROM contracts link_contract
     WHERE link_contract.id = gr.contract_id
       AND (
         link_contract.created_by = ${userParam}
         OR link_contract.closing_employee_id = ${userParam}
         OR (${employeeParam}::int IS NOT NULL AND link_contract.sale_owner_id = ${employeeParam}::int)
       )
  )`;
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
  if (subject.contractLinkedToCurrentUser) return context.userId;
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
  if (
    permission === 'contract_gifts.reopen_manual_delivery'
    && !context.isSuperAdmin
    && !context.grants.some(grant => (
      grant.permission === permission && grant.scope === 'GLOBAL'
    ))
  ) {
    return false;
  }
  return authorize(context, {
    permission,
    branchId: branchIdForGift(subject),
    assignedUserId: assignedUserForGift(context, subject, currentEmployeeId),
  }).allowed;
}

export function getGiftListAccessPlan(context: AuthContext, permission: string) {
  return resolveListAccessScope(context, permission);
}
