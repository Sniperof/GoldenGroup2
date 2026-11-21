import type { AuthUser } from '@golden-crm/shared';
import type { PermissionGrant } from '../hooks/useAuthStore';
import { canCrossBranch } from './branchScope';

/**
 * Which VIEW permission governs the records of each section — the same key the
 * server's resolveBranchView uses for that list (routes/*.ts). The external
 * branch switcher offers, per section, only the branches this grant reaches:
 * GLOBAL → every branch; BRANCH/ASSIGNED → the user's assigned branches.
 *
 * A path not listed here keeps today's behaviour (every branch offered). Add a
 * section when its list moves onto resolveBranchView on the server.
 */
export const SECTION_VIEW_PERMISSIONS: ReadonlyArray<readonly [prefix: string, permission: string]> = [
  ['/clients', 'clients.view_list'],
  ['/candidates', 'candidates.view_list'],
  ['/contracts', 'contracts.view_list'],
  ['/employees', 'employees.view_list'],
  ['/installed-devices', 'installed_devices.view'],
  ['/complaints', 'complaints.view_list'],
  ['/admin/users', 'admin.users.view_list'],
  ['/tasks/open', 'open_tasks.view'],
  ['/tasks/group/device-demo', 'tasks.demo.view'],
  ['/tasks/group/maintenance', 'tasks.maintenance.view'],
  ['/tasks/group/collection', 'tasks.collection.view'],
  ['/receivables/uncovered', 'tasks.collection.view'],
  ['/tasks/group/after-sale-services', 'tasks.after_sales.view'],
  ['/tasks/group/gift-delivery', 'tasks.gifts.view'],
  ['/tasks/group/warranty-services', 'tasks.warranty.view'],
  ['/tasks/group/device-delivery', 'tasks.delivery.view'],
  ['/tasks/group/device-installation', 'tasks.installation.view'],
  ['/tasks/group/device-activation', 'tasks.activation.view'],
  ['/tasks/group/device-disconnection', 'tasks.disconnection.view'],
  ['/tasks/group/device-retrieval', 'tasks.after_sales.view'],
  ['/tasks/group/device-return', 'tasks.after_sales.view'],
  ['/tasks/group/device-transfer', 'tasks.after_sales.view'],
  ['/jobs/vacancies', 'jobs.vacancies.view_list'],
  ['/jobs/applications', 'jobs.applications.view_list'],
  ['/jobs/interviews', 'jobs.interviews.view_list'],
];

/** Longest matching section prefix (on a path-segment boundary), or null. */
export function viewPermissionForPath(pathname: string): string | null {
  let best: readonly [string, string] | null = null;
  for (const entry of SECTION_VIEW_PERMISSIONS) {
    const [prefix] = entry;
    const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (matches && (best == null || prefix.length > best[0].length)) best = entry;
  }
  return best ? best[1] : null;
}

/**
 * Branches the external switcher may offer on this path.
 *   null      → no limit (every branch), i.e. today's behaviour.
 *   number[]  → only these (the section's grant is BRANCH/ASSIGNED).
 * Only cross-branch users have a switcher at all; for everyone else → null.
 */
export function sectionBranchLimit(
  pathname: string,
  user: Pick<AuthUser, 'isSuperAdmin' | 'branchId' | 'allowedBranchIds'> | null | undefined,
  grants: PermissionGrant[] | null | undefined,
): number[] | null {
  if (!user || user.isSuperAdmin === true || !canCrossBranch(user, grants)) return null;
  const permission = viewPermissionForPath(pathname);
  if (!permission) return null;
  const scope = (grants ?? []).find(grant => grant.permission === permission)?.scope;
  if (scope !== 'BRANCH' && scope !== 'ASSIGNED') return null;
  if (Array.isArray(user.allowedBranchIds)) return [...user.allowedBranchIds];
  return user.branchId != null ? [user.branchId] : [];
}
