import { hasCrossBranchReach, type AuthUser } from '@golden-crm/shared';
import type { PermissionGrant } from '../hooks/useAuthStore';

/**
 * "Can this user reach across branches?" — i.e. does the external branch filter
 * (sidebar switcher + the "showing: branch X" indicator) apply to them. See
 * branch-scope-and-visibility-standard.md §4.
 *
 * The rule itself lives in @golden-crm/shared (branchReach.ts) so the server,
 * which decides which branch a request acts on, uses the very same definition:
 * super admin OR a GLOBAL scope on an operational LIST view (`*.view_list`).
 */
export function canCrossBranch(
  user: Pick<AuthUser, 'isSuperAdmin'> | null | undefined,
  grants: PermissionGrant[] | null | undefined,
): boolean {
  return hasCrossBranchReach(user?.isSuperAdmin, grants);
}
