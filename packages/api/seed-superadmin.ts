/**
 * Production seed — creates the superadmin user with no branch.
 * The superadmin logs in and creates branches from the UI.
 *
 * Safe to run multiple times (idempotent).
 * Does NOT deactivate other users or touch any other data.
 *
 * Run with:
 *   docker compose run --rm --no-deps -e NODE_ENV=production app \
 *     node ./node_modules/tsx/dist/cli.mjs packages/api/seed-superadmin.ts
 */

import bcrypt from 'bcryptjs';
import pool from './db.js';

const SUPERADMIN_USERNAME = 'superadmin';
const SUPERADMIN_NAME     = 'Super Admin';
const SUPERADMIN_PASSWORD = 'Password123!';
const BCRYPT_ROUNDS       = 10;

async function main() {
  console.log('\n=== Golden CRM — Seed Superadmin ===\n');

  const { rows: roleRows } = await pool.query(
    `SELECT id FROM roles WHERE name = 'SYSTEM_ADMIN' LIMIT 1`,
  );

  if (!roleRows[0]) {
    console.error('✗ SYSTEM_ADMIN role not found — run migrations first.');
    process.exit(1);
  }

  const roleId = roleRows[0].id;
  const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD, BCRYPT_ROUNDS);

  await pool.query(
    `INSERT INTO hr_users
       (name, username, password_hash, role, role_id, is_active, is_super_admin)
     VALUES ($1, $2, $3, 'SYSTEM_ADMIN', $4, TRUE, TRUE)
     ON CONFLICT (username)
     DO UPDATE SET
       name          = EXCLUDED.name,
       password_hash = EXCLUDED.password_hash,
       role_id       = EXCLUDED.role_id,
       is_active     = TRUE,
       is_super_admin = TRUE`,
    [SUPERADMIN_NAME, SUPERADMIN_USERNAME, passwordHash, roleId],
  );

  console.log('✓ Superadmin ready');
  console.log(`  username : ${SUPERADMIN_USERNAME}`);
  console.log(`  password : ${SUPERADMIN_PASSWORD}`);
  console.log('\n  Next: log in and create branches from the UI.\n');

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
