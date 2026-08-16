import type { PermissionGrant } from '@golden-crm/shared';

export function canSeeFieldVisitManagementSurface(input: {
  grants: PermissionGrant[];
  isSuperAdmin: boolean;
}): boolean {
  if (input.isSuperAdmin) return true;
  return input.grants.some(
    grant => grant.permission === 'field_visits.view'
      && (grant.scope === 'GLOBAL' || grant.scope === 'BRANCH'),
  );
}
