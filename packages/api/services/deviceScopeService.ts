import type { AuthContext } from '@golden-crm/shared';
import pool from '../db.js';

// Device-model visibility inside operational surfaces (a contract or a task) is
// governed by `device_models.task_lookup`, scoped per the devices constitution
// §6.1:
//   GLOBAL   → the full catalog (also super-admin and admin catalog readers).
//   BRANCH   → every device authorized in any department of the acting branch
//              (a branch manager sees all departments of their branch).
//   ASSIGNED → only the devices authorized for the actor's own department
//              (a supervisor sees their department only).
//
// Returns a Set of authorized device_model ids, or `null` meaning unrestricted
// (the whole catalog). An empty Set means the actor may see nothing.

const ADMIN_ALL_KEYS = ['device_models.lookup', 'device_models.manage', 'catalog.manage'];

export async function resolveAuthorizedDeviceModelIds(
  authContext: AuthContext,
  actingBranchId?: number | null,
): Promise<Set<number> | null> {
  if (authContext.isSuperAdmin) return null;

  const grants = authContext.grants;

  // Admin-level catalog access (GLOBAL) sees the entire catalog.
  if (grants.some(g => ADMIN_ALL_KEYS.includes(g.permission) && g.scope === 'GLOBAL')) {
    return null;
  }

  const taskGrant = grants.find(g => g.permission === 'device_models.task_lookup');
  if (!taskGrant) return new Set<number>(); // no operational device read access

  if (taskGrant.scope === 'GLOBAL') return null;

  if (taskGrant.scope === 'BRANCH') {
    const branchIds =
      actingBranchId != null && actingBranchId > 0 ? [actingBranchId] : authContext.allowedBranchIds;
    if (!branchIds || branchIds.length === 0) return new Set<number>();
    const { rows } = await pool.query(
      `SELECT DISTINCT (jsonb_array_elements_text(device_model_ids))::int AS id
         FROM departments
        WHERE branch_id = ANY($1::int[])
          AND jsonb_array_length(COALESCE(device_model_ids, '[]'::jsonb)) > 0`,
      [branchIds],
    );
    return new Set(rows.map(r => Number(r.id)));
  }

  // ASSIGNED — devices authorized for the actor's own department only.
  const { rows } = await pool.query(
    `SELECT (jsonb_array_elements_text(d.device_model_ids))::int AS id
       FROM departments d
       JOIN employees e ON e.department_id = d.id
       JOIN hr_users u ON u.employee_id = e.id
      WHERE u.id = $1
        AND jsonb_array_length(COALESCE(d.device_model_ids, '[]'::jsonb)) > 0`,
    [authContext.userId],
  );
  return new Set(rows.map(r => Number(r.id)));
}

/**
 * Server-side guard mirroring assertGeoUnitInScope: a contract/task that saves a
 * deviceModelId must re-verify it is authorized for the actor's scope. UI
 * filtering is not security.
 */
export async function assertDeviceModelInScope(
  authContext: AuthContext,
  deviceModelId: number | string | null | undefined,
  actingBranchId?: number | null,
): Promise<{ allowed: boolean; reason?: string }> {
  const id = Number(deviceModelId);
  if (!Number.isInteger(id) || id <= 0) return { allowed: true }; // no device — caller decides if required
  const authorized = await resolveAuthorizedDeviceModelIds(authContext, actingBranchId);
  if (authorized === null) return { allowed: true }; // unrestricted
  if (!authorized.has(id)) return { allowed: false, reason: 'device_model_outside_scope' };
  return { allowed: true };
}
