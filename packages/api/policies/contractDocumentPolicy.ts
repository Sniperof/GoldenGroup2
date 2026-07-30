import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { authorize } from '../services/authorizationService.js';

export interface ContractDocumentSubject {
  branchId: number | null;
}

export function canViewContractDocument(
  context: AuthContext,
  subject: ContractDocumentSubject,
): AuthorizationResult {
  return authorize(context, {
    permission: 'contracts.view_list',
    branchId: subject.branchId,
  });
}

export function canFreezeContractDocument(
  context: AuthContext,
  subject: ContractDocumentSubject,
): AuthorizationResult {
  return authorize(context, {
    permission: 'contracts.edit',
    branchId: subject.branchId,
  });
}
