import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { authorize } from '../services/authorizationService.js';

export const DEVICE_DELIVERY_SUSPENSION_PERMISSION =
  'installed_devices.delivery_suspension.manage' as const;

export function canManageDeviceDeliverySuspension(
  context: AuthContext,
  subject: { branchId: number | null },
): AuthorizationResult {
  if (subject.branchId == null) {
    return { allowed: false, reason: 'MISSING_BRANCH_CONTEXT' };
  }
  return authorize(context, {
    permission: DEVICE_DELIVERY_SUSPENSION_PERMISSION,
    branchId: subject.branchId,
    assignedUserId: null,
  });
}
