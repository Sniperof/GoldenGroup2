import type { AuthContext } from '@golden-crm/shared';
import pool from '../db.js';

export const TEMPLATE_ROLE_ASSIGNMENT_ERROR =
  'يجب إسناد role template فقط، ولا يمكن إسناد branch-specific clone role مباشرة';

export const ROLE_ESCALATION_ERROR =
  'لا يمكنك إسناد دور يحتوي على صلاحيات أوسع من صلاحياتك';

const SCOPE_RANK: Record<string, number> = { ASSIGNED: 1, BRANCH: 2, GLOBAL: 3 };

// Escalation-capable permissions: administrative / cross-branch / system-config
// capabilities. Only these gate role assignment. Operational permissions
// (clients, telemarketing, jobs, tasks, field visits…) are freely delegable
// within the branch even if the assigner does not personally hold them — a
// branch manager need not be granted every operational capability just to
// assign an operational role to his staff.
export const SENSITIVE_PERMISSION_KEYS = new Set<string>([
  'admin.roles.view',
  'admin.roles.manage',
  'admin.roles.users.manage',
  'admin.system_lists.view',
  'admin.system_lists.manage',
  'admin.task_types.manage',
  'admin.emergency_action_types.manage',
  'users.branch_assignments.view',
  'users.branch_assignments.manage',
  'branches.edit',
  'branches.manage',
  'departments.manage',
  'catalog.manage',
  'device_models.manage',
  'spare_parts.manage',
  'devices.discounts.manage',
  'settings.view',
  'settings.manage',
]);

export type RoleAssignmentScopeCheck =
  | { ok: true }
  | { ok: false; reason: 'ROLE_EXCEEDS_ASSIGNER'; exceeded: string[] };

/**
 * Privilege-escalation guard. A non-super-admin may assign a role only if, for
 * every **sensitive/administrative** grant that role carries (see
 * SENSITIVE_PERMISSION_KEYS), the assigner holds the same permission at an
 * equal-or-broader scope (GLOBAL > BRANCH > ASSIGNED). This stops a branch
 * manager (admin.roles.users.manage = BRANCH) from handing out a role that
 * carries system/cross-branch powers they do not themselves hold — e.g. a role
 * with admin.roles.manage GLOBAL — while still allowing them to delegate purely
 * operational roles (supervisor, technician) for their branch.
 */
export async function assertRoleWithinActorScope(
  authContext: AuthContext,
  roleId: number,
): Promise<RoleAssignmentScopeCheck> {
  if (authContext.isSuperAdmin) return { ok: true };

  const { rows } = await pool.query(
    `SELECT p.key AS permission, rpg.scope_type AS scope
       FROM role_permission_grants rpg
       JOIN permissions p ON p.id = rpg.permission_id
      WHERE rpg.role_id = $1
        AND p.key = ANY($2::text[])`,
    [roleId, [...SENSITIVE_PERMISSION_KEYS]],
  );

  const actorScopeByKey = new Map<string, number>();
  for (const g of authContext.grants) {
    const rank = SCOPE_RANK[g.scope] ?? 0;
    if (rank > (actorScopeByKey.get(g.permission) ?? 0)) {
      actorScopeByKey.set(g.permission, rank);
    }
  }

  const exceeded: string[] = [];
  for (const row of rows) {
    const needed = SCOPE_RANK[row.scope] ?? 0;
    const held = actorScopeByKey.get(row.permission) ?? 0;
    if (held < needed) exceeded.push(row.permission);
  }

  if (exceeded.length > 0) {
    return { ok: false, reason: 'ROLE_EXCEEDS_ASSIGNER', exceeded };
  }
  return { ok: true };
}

export type TemplateRoleAssignmentTarget = {
  id: number;
  name: string;
  displayName: string;
  isActive: boolean;
  isTemplate: boolean;
  templateId: number | null;
  branchId: number | null;
};

export type TemplateRoleAssignmentValidation =
  | { ok: true; role: TemplateRoleAssignmentTarget }
  | { ok: false; reason: 'NOT_FOUND' | 'CLONE_ROLE_NOT_ALLOWED' };

export async function validateTemplateRoleAssignment(
  roleId: number,
): Promise<TemplateRoleAssignmentValidation> {
  const { rows } = await pool.query(
    `SELECT id,
            name,
            display_name AS "displayName",
            is_active AS "isActive",
            is_template AS "isTemplate",
            template_id AS "templateId",
            branch_id AS "branchId"
       FROM roles
      WHERE id = $1`,
    [roleId],
  );

  const role = rows[0] as TemplateRoleAssignmentTarget | undefined;
  if (!role) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  if (role.isTemplate !== true || role.templateId != null) {
    return { ok: false, reason: 'CLONE_ROLE_NOT_ALLOWED' };
  }

  return { ok: true, role };
}
