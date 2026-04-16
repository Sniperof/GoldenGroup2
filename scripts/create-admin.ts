import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const devEnvFile = path.join(root, '.env.development');
const defaultEnvFile = path.join(root, '.env');
const envFile = fs.existsSync(devEnvFile) ? devEnvFile : defaultEnvFile;

dotenv.config({ path: envFile });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(`DATABASE_URL is missing. Expected it in ${envFile}`);
  process.exit(1);
}

const username = process.env.ADMIN_USERNAME?.trim() || 'admin';
const password = process.env.ADMIN_PASSWORD?.trim() || 'Admin@12345';
const name = process.env.ADMIN_NAME?.trim() || 'مدير النظام';

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl });

async function main() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const roleResult = await client.query(
      `INSERT INTO roles (name, display_name, description, is_system, is_active)
       VALUES ($1, $2, $3, TRUE, TRUE)
       ON CONFLICT (name) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           description = EXCLUDED.description,
           is_system = TRUE,
           is_active = TRUE,
           updated_at = NOW()
       RETURNING id, name`,
      ['ADMIN', 'مدير النظام', 'دور إداري كامل الصلاحيات']
    );

    const roleId = roleResult.rows[0].id as number;

    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId]
    );

    const passwordHash = await bcrypt.hash(password, 10);

    const userResult = await client.query(
      `INSERT INTO hr_users (name, username, password_hash, role, role_id, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (username) DO UPDATE
       SET name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           role_id = EXCLUDED.role_id,
           is_active = TRUE
       RETURNING id, username`,
      [name, username, passwordHash, 'ADMIN', roleId]
    );

    await client.query('COMMIT');

    console.log('Admin user is ready.');
    console.log(`Username: ${userResult.rows[0].username}`);
    console.log(`Password: ${password}`);
    console.log('Change the password after the first login.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Failed to create admin:', error);
  process.exit(1);
});
