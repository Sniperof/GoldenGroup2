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
