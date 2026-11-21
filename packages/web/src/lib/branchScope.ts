import { hasBranchChoice, hasCrossBranchReach, type AuthUser } from '@golden-crm/shared';
import type { PermissionGrant } from '../hooks/useAuthStore';

/**
 * "Does this user choose among branches?" — i.e. does the external branch filter
 * (sidebar switcher + the "showing: branch X" indicator) apply to them. See
 * branch-scope-and-visibility-standard.md §4.
 *
 * True for cross-branch reach (super admin, or a GLOBAL `*.view_list`) AND for a
 * user assigned to several branches (their branches only). The rules live in
 * @golden-crm/shared (branchReach.ts) so the server, which decides which branch
 * a request acts on, uses the very same definitions.
 */
export function canCrossBranch(
  user: Pick<AuthUser, 'isSuperAdmin' | 'allowedBranchIds'> | null | undefined,
  grants: PermissionGrant[] | null | undefined,
): boolean {
  return hasBranchChoice(user?.isSuperAdmin, grants, user?.allowedBranchIds);
}

/** Only these users may select a branch OUTSIDE their assignments. */
export function canReachAnyBranch(
  user: Pick<AuthUser, 'isSuperAdmin'> | null | undefined,
  grants: PermissionGrant[] | null | undefined,
): boolean {
  return hasCrossBranchReach(user?.isSuperAdmin, grants);
}
