import pool from '../db.js';

export interface LoginUserRecord {
  id: number;
  name: string;
  username: string;
  password_hash: string;
  role: string;
  role_id: number | null;
  role_display_name: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  branch_id: number | null;
}

export async function findUserForLogin(username: string): Promise<LoginUserRecord | null> {
  const { rows } = await pool.query(
    `SELECT u.id,
            u.name,
            u.username,
            u.password_hash,
            u.role,
            u.role_id,
            r.display_name AS role_display_name,
            u.is_active,
            u.is_super_admin,
            u.branch_id
       FROM hr_users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.username = $1`,
    [username.trim()]
  );

  return rows[0] ?? null;
}

export async function getRolePermissions(roleId: number): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT p.key FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [roleId]
  );

  return rows.map((r: any) => r.key);
}

export interface RoleGrant {
  permission: string;
  scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED';
}

export async function getRoleGrants(roleId: number): Promise<RoleGrant[]> {
  const { rows } = await pool.query(
    `SELECT p.key AS permission, rpg.scope_type AS scope
       FROM role_permission_grants rpg
       JOIN permissions p ON p.id = rpg.permission_id
      WHERE rpg.role_id = $1`,
    [roleId]
  );
  return rows.map((r: any) => ({ permission: r.permission, scope: r.scope as RoleGrant['scope'] }));
}
