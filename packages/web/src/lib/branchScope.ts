import type { AuthUser } from '@golden-crm/shared';
import type { PermissionGrant } from '../hooks/useAuthStore';

/**
 * Single source of truth for "can this user reach across branches?" — i.e. does the
 * external branch filter (sidebar switcher + the "showing: branch X" indicator) apply
 * to them. See branch-scope-and-visibility-standard.md §4.
 *
 * Cross-branch reach = super admin OR a GLOBAL scope on an operational LIST view
 * (`*.view_list`). It must NOT be "any GLOBAL grant": branch managers / supervisors
 * hold reference & catalog lookups (device_models.lookup, reference_data.lookup,
 * *.task_lookup …) at GLOBAL for form-filling — those do NOT grant cross-branch record
 * visibility. Keeping the rule here prevents the two surfaces from drifting apart (a
 * mismatch previously leaked the switcher to branch managers).
 */
export function canCrossBranch(
  user: Pick<AuthUser, 'isSuperAdmin'> | null | undefined,
  grants: PermissionGrant[] | null | undefined,
): boolean {
  if (user?.isSuperAdmin === true) return true;
  return (grants ?? []).some(g => g.scope === 'GLOBAL' && g.permission.endsWith('.view_list'));
}
