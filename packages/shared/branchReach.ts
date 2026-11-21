// ============================================================
// branchReach.ts — the ONE definition of "cross-branch reach"
// ============================================================
// Used by the server (authorizationService: which branch the request acts on)
// and the web (the external branch switcher + "showing: branch X" indicator).
// Before 2026-11-21 the two sides held separate copies; when they drift, the
// switcher offers branches the server then ignores — exactly the bug that hid
// whole branches from GLOBAL operators.
//
// Cross-branch reach = super admin OR a GLOBAL scope on an operational LIST view
// (`*.view_list`). Reference lookups held at GLOBAL for form-filling
// (reference_data.lookup, device_models.lookup, *.task_lookup …) deliberately
// do NOT count: they never grant cross-branch record visibility.
// ============================================================

export interface BranchReachGrant {
  permission: string;
  scope: string;
}

export function hasCrossBranchReach(
  isSuperAdmin: boolean | null | undefined,
  grants: ReadonlyArray<BranchReachGrant> | null | undefined,
): boolean {
  if (isSuperAdmin === true) return true;
  return (grants ?? []).some(grant => grant.scope === 'GLOBAL' && grant.permission.endsWith('.view_list'));
}

/**
 * Does the user CHOOSE among branches? True for cross-branch reach (any branch)
 * and for a user assigned to more than one branch (their branches only — a
 * BRANCH grant over several assignments is "global over specific branches").
 *
 * Such a user gets the external switcher, and "all (your) branches" means no
 * acting branch: nothing — a write, a single-branch page — silently falls back
 * to their primary branch. A one-branch user keeps acting on that branch.
 *
 * Note the difference: only hasCrossBranchReach lets the selection be a branch
 * OUTSIDE the assignments; a multi-branch user's selection must be one of them.
 */
export function hasBranchChoice(
  isSuperAdmin: boolean | null | undefined,
  grants: ReadonlyArray<BranchReachGrant> | null | undefined,
  allowedBranchIds: ReadonlyArray<number> | null | undefined,
): boolean {
  return hasCrossBranchReach(isSuperAdmin, grants) || (allowedBranchIds?.length ?? 0) > 1;
}
