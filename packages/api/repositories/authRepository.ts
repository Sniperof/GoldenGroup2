import pool from '../db.js';

export interface LoginUserRecord {
  id: number;
  name: string;
  username: string;
  password_hash: string;
  role: string;
  role_id: number | null;
  is_active: boolean;
}

export async function findUserForLogin(username: string): Promise<LoginUserRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, name, username, password_hash, role, role_id, is_active
     FROM hr_users WHERE username = $1`,
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
