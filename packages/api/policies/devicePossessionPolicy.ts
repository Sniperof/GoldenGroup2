import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { authorize } from '../services/authorizationService.js';

export type DevicePossessionPermission =
  | 'installed_devices.possession.view'
  | 'installed_devices.possession.manage';

export interface DevicePossessionSubject {
  branchId: number | null;
}

export function canAccessDevicePossession(
  context: AuthContext,
  permission: DevicePossessionPermission,
  subject: DevicePossessionSubject,
): AuthorizationResult {
  return authorize(context, {
    permission,
    branchId: subject.branchId,
    assignedUserId: null,
  });
}
