import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { authorize } from '../services/authorizationService.js';

export interface ServiceRequestPartyLinkSubject {
  permission: string;
  branchId: number | null;
  reviewedByUserId: number | null;
}

/** Subject decision shared by beneficiary, requester, referrer and suggestions. */
export function canLinkServiceRequestParty(
  context: AuthContext,
  subject: ServiceRequestPartyLinkSubject,
): AuthorizationResult {
  return authorize(context, {
    permission: subject.permission,
    branchId: subject.branchId,
    assignedUserId: subject.reviewedByUserId,
  });
}
