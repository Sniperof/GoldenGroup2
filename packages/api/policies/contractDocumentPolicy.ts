import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { canAccessContract } from './contractPolicy.js';

export interface ContractDocumentSubject {
  branchId: number | null;
  /** Needed for ASSIGNED grants (sale owner = assigned); see contractPolicy. */
  saleOwnerId?: number | null;
  /** The actor's hr_users.employee_id, resolved with the subject. */
  currentEmployeeId?: number | null;
}

function check(context: AuthContext, permission: string, subject: ContractDocumentSubject): AuthorizationResult {
  return canAccessContract(
    context,
    permission,
    { branchId: subject.branchId, saleOwnerId: subject.saleOwnerId ?? null },
    subject.currentEmployeeId ?? null,
  );
}

export function canViewContractDocument(
  context: AuthContext,
  subject: ContractDocumentSubject,
): AuthorizationResult {
  return check(context, 'contracts.view_list', subject);
}

export function canFreezeContractDocument(
  context: AuthContext,
  subject: ContractDocumentSubject,
): AuthorizationResult {
  return check(context, 'contracts.edit', subject);
}
