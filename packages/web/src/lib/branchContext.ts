const GLOBAL_ONLY_PATH_PREFIXES = [
  '/admin/roles',
  '/branches',
];

const GLOBAL_ONLY_PATHS = new Set([
  '/settings',
  '/system-lists',
  '/geo',
  '/routes',
]);

export function isGlobalOnlyPath(pathname: string): boolean {
  if (GLOBAL_ONLY_PATHS.has(pathname)) {
    return true;
  }

  return GLOBAL_ONLY_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function shouldAttachBranchContextHeader(pathname: string): boolean {
  return !isGlobalOnlyPath(pathname);
}
