// Group 2 pages (branch-scope-and-visibility-standard.md §6): top-management /
// reference surfaces whose data is global — the admin branch filter must NOT apply,
// so its X-Branch-Id is never attached here. NOTE: `/devices` = the global device
// catalog only; `/installed-devices/:id` is operational (Group 1) and is intentionally
// NOT listed. Group 3 branch-only pages (planning, telemarketer, supervisor) DO use
// the branch context, so they are likewise excluded from this list.
//
// `/geo` is deliberately NOT here (§2.6): the administrative-levels page has a branch
// dimension (coverage), so it must honour the filter — a GLOBAL operator who picks a
// branch sees that branch's coverage, and "all branches" yields the full tree. The
// server (resolveRequestedGeoScope) stays the source of truth.
const GLOBAL_ONLY_PATH_PREFIXES = [
  '/admin',            // roles, permissions-settings, task-types, emergency-action-types
  '/branches',
  '/devices',          // device catalog (NOT /installed-devices — that is operational)
  '/service-requests', // central intake (GLOBAL only)
];

const GLOBAL_ONLY_PATHS = new Set([
  '/settings',
  '/system-lists',
]);

// Group-1 records pages that live UNDER an otherwise global-only prefix but must
// honour the branch filter (e.g. the Users page sits under /admin yet is scoped
// like clients/employees). Listed here so the X-Branch-Id header IS attached.
const GROUP1_UNDER_GLOBAL_PREFIX = ['/admin/users'];

export function isGlobalOnlyPath(pathname: string): boolean {
  if (GROUP1_UNDER_GLOBAL_PREFIX.some(p => pathname === p || pathname.startsWith(`${p}/`))) {
    return false;
  }

  if (GLOBAL_ONLY_PATHS.has(pathname)) {
    return true;
  }

  return GLOBAL_ONLY_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function shouldAttachBranchContextHeader(pathname: string): boolean {
  return !isGlobalOnlyPath(pathname);
}
