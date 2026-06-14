import type { AuthUser } from '@golden-crm/shared';
import pool from '../db.js';

export type SessionUserErrorCode = 'INVALID_TOKEN_USER' | 'USER_NOT_FOUND' | 'USER_INACTIVE';

export class SessionUserError extends Error {
  constructor(
    public readonly code: SessionUserErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionUserError';
  }
}

export async function loadSessionUserFromToken(tokenUser: Pick<AuthUser, 'id'>): Promise<AuthUser> {
  const userId = Number(tokenUser.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new SessionUserError('INVALID_TOKEN_USER', 'رمز التحقق لا يحتوي مستخدما صالحا');
  }

  const { rows } = await pool.query(
    `SELECT u.id,
            u.name,
            u.role,
            u.role_id,
            r.display_name AS role_display_name,
            u.is_active,
            u.is_super_admin,
            u.branch_id,
            u.employee_id
       FROM hr_users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1`,
    [userId],
  );

  const row = rows[0];
  if (!row) {
    throw new SessionUserError('USER_NOT_FOUND', 'المستخدم غير موجود');
  }
  if (row.is_active !== true) {
    throw new SessionUserError('USER_INACTIVE', 'الحساب غير مفعل');
  }

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    roleId: row.role_id ?? null,
    roleDisplayName: row.role_display_name ?? null,
    isSuperAdmin: row.is_super_admin === true,
    branchId: row.branch_id ?? null,
    employeeId: row.employee_id ?? null,
  };
}
