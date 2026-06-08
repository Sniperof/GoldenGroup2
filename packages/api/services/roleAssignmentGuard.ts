import pool from '../db.js';

export const TEMPLATE_ROLE_ASSIGNMENT_ERROR =
  'يجب إسناد role template فقط، ولا يمكن إسناد branch-specific clone role مباشرة';

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
