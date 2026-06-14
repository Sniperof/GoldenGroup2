import pool from '../db.js';

export const TEAM_SLOT_TYPES = ['SUPERVISOR', 'TECHNICIAN', 'TRAINEE', 'TELEMARKETER'] as const;
export type TeamSlotType = typeof TEAM_SLOT_TYPES[number];

const VALID_TEAM_SLOT_TYPES = new Set<TeamSlotType>(TEAM_SLOT_TYPES);

export interface CreateRoleInput {
  name: string;
  displayName: string;
  description?: string | null;
  teamSlotType?: TeamSlotType | null;
}

export interface UpdateRoleInput {
  displayName?: string;
  description?: string | null;
  isActive?: boolean;
  teamSlotType?: TeamSlotType | null;
}

export type RoleManagementErrorCode =
  | 'ROLE_NOT_FOUND'
  | 'ROLE_PROTECTED'
  | 'ROLE_IN_USE'
  | 'ROLE_NAME_CONFLICT'
  | 'INVALID_INPUT';

export class RoleManagementError extends Error {
  constructor(
    public readonly code: RoleManagementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoleManagementError';
  }
}

export async function createRole(input: CreateRoleInput): Promise<Record<string, unknown>> {
  const name = input.name?.trim();
  const displayName = input.displayName?.trim();
  if (!name) {
    throw new RoleManagementError('INVALID_INPUT', 'اسم الدور مطلوب');
  }
  if (!displayName) {
    throw new RoleManagementError('INVALID_INPUT', 'الاسم المعروض مطلوب');
  }
  validateTeamSlotType(input.teamSlotType);

  try {
    const { rows } = await pool.query(
      `INSERT INTO roles (
         name, display_name, description, branch_id, is_template, template_id, team_slot_type
       )
       VALUES ($1, $2, $3, NULL, TRUE, NULL, $4)
       RETURNING *`,
      [
        name,
        displayName,
        normalizeDescription(input.description),
        input.teamSlotType ?? null,
      ],
    );
    return rows[0];
  } catch (error) {
    if (isPostgresError(error, '23505')) {
      throw new RoleManagementError('ROLE_NAME_CONFLICT', 'يوجد دور بنفس الاسم بالفعل');
    }
    throw error;
  }
}

export async function updateRole(
  roleId: number,
  input: UpdateRoleInput,
): Promise<Record<string, unknown>> {
  validateRoleId(roleId);
  validateTeamSlotType(input.teamSlotType);
  if (input.displayName !== undefined && input.displayName.trim().length === 0) {
    throw new RoleManagementError('INVALID_INPUT', 'الاسم المعروض لا يمكن أن يكون فارغا');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const role = await loadMutableRole(client, roleId);

    const { rows } = await client.query(
      `UPDATE roles SET
         display_name = CASE WHEN $1 THEN $2 ELSE display_name END,
         description = CASE WHEN $3 THEN $4 ELSE description END,
         is_active = CASE WHEN $5 THEN $6 ELSE is_active END,
         team_slot_type = CASE WHEN $7 THEN $8::text ELSE team_slot_type END,
         updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        input.displayName !== undefined,
        input.displayName?.trim() ?? role.display_name,
        input.description !== undefined,
        normalizeDescription(input.description),
        input.isActive !== undefined,
        input.isActive ?? role.is_active,
        input.teamSlotType !== undefined,
        input.teamSlotType ?? null,
        roleId,
      ],
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteRole(roleId: number): Promise<void> {
  validateRoleId(roleId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await loadMutableRole(client, roleId);

    const { rows } = await client.query(
      'SELECT COUNT(*)::int AS count FROM hr_users WHERE role_id = $1',
      [roleId],
    );
    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new RoleManagementError(
        'ROLE_IN_USE',
        'لا يمكن حذف دور مرتبط بمستخدمين',
      );
    }

    await client.query('DELETE FROM roles WHERE id = $1', [roleId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadMutableRole(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  roleId: number,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT *
       FROM roles
      WHERE id = $1
      FOR UPDATE`,
    [roleId],
  );
  const role = rows[0];
  if (!role) {
    throw new RoleManagementError('ROLE_NOT_FOUND', 'الدور غير موجود');
  }
  if (role.is_system || role.is_protected) {
    const reason = typeof role.protected_reason === 'string'
      ? role.protected_reason.trim()
      : '';
    throw new RoleManagementError(
      'ROLE_PROTECTED',
      reason
        ? `لا يمكن تعديل أو حذف هذا الدور المحمي: ${reason}`
        : 'لا يمكن تعديل أو حذف هذا الدور المحمي',
    );
  }
  return role;
}

function validateRoleId(roleId: number): void {
  if (!Number.isInteger(roleId) || roleId <= 0) {
    throw new RoleManagementError('ROLE_NOT_FOUND', 'الدور غير موجود');
  }
}

function validateTeamSlotType(value: TeamSlotType | null | undefined): void {
  if (value != null && !VALID_TEAM_SLOT_TYPES.has(value)) {
    throw new RoleManagementError('INVALID_INPUT', 'نوع خانة الفريق غير صالح');
  }
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isPostgresError(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === code;
}
