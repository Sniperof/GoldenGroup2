import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { authorize } from '../services/authorizationService.js';

export interface TelemarketingServiceTaskSubject {
  branchId: number | null;
  assignedUserIds: number[];
}

export function canCreateTelemarketingServiceTask(
  context: AuthContext,
  subject: TelemarketingServiceTaskSubject,
): AuthorizationResult {
  return authorize(context, {
    permission: 'telemarketing.calls.create',
    branchId: subject.branchId,
    assignedUserId: subject.assignedUserIds.includes(context.userId) ? context.userId : null,
  });
}
