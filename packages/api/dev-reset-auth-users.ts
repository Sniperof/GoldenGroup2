/**
 * DEV ONLY — Auth Users Reset Script
 *
 * Creates two clean test users for verifying the authorization pipeline:
 *   global_admin — DEV_GLOBAL_ADMIN role, GLOBAL-scope grants on all permissions
 *                 and super-admin branch switching enabled for UI testing
 *   branch_user  — DEV_BRANCH_USER role, BRANCH-scope grants on key modules
 *
 * Run with:
 *   cd packages/api && tsx dev-reset-auth-users.ts
 *
 * WARNING: This script deletes the two dev users above (if they exist)
 * and re-creates them fresh. It does NOT touch any other user accounts.
 * Never run against production.
 */

import bcrypt from 'bcryptjs';
import pool from './db.js';

// ── Config ──────────────────────────────────────────────────────────────────

const DEV_PASSWORD = 'Password123!';
const BCRYPT_ROUNDS = 10;

const GLOBAL_USERNAME = 'global_admin';
const BRANCH_USERNAME = 'branch_user';

const GLOBAL_ROLE_NAME = 'DEV_GLOBAL_ADMIN';
const BRANCH_ROLE_NAME = 'DEV_BRANCH_USER';

const TEST_BRANCH_NAME = 'Dev Test Branch';

// Permissions granted to DEV_BRANCH_USER (BRANCH scope).
// Covers every module that has been through the authorization refactor.
const BRANCH_USER_PERMISSIONS = [
  'employees.view_list',
  'employees.create',
  'employees.edit',
  'employees.delete',
  'candidates.view_list',
  'candidates.create',
  'candidates.edit',
  'candidates.delete',
  'referral_sheets.view_list',
  'referral_sheets.create',
  'referral_sheets.edit',
  'referral_sheets.delete',
  'clients.view_list',
  'clients.view',
  'clients.create',
  'clients.edit',
  'clients.delete',
  'contracts.view_list',
  'contracts.create',
  'contracts.edit',
  'contracts.delete',
  'tasks.view_list',
  'tasks.create',
  'tasks.edit',
  'tasks.delete',
  'departments.view_list',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`  ✓ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠ ${msg}`); }
function section(title: string) { console.log(`\n── ${title}`); }

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n==========================================================');
  console.log(' DEV AUTH RESET — golden-crm');
  console.log('==========================================================');
  console.log(' WARNING: dev/test environment only.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Ensure test branch ──────────────────────────────────────────────
    section('Test Branch');

    let branchId: number;
    const existingBranch = await client.query(
      `SELECT id FROM branches WHERE name = $1 LIMIT 1`,
      [TEST_BRANCH_NAME],
    );
    if (existingBranch.rows[0]) {
      branchId = existingBranch.rows[0].id;
      log(`Using existing branch: "${TEST_BRANCH_NAME}" (id=${branchId})`);
    } else {
      // Try to reuse the first active branch instead of creating a new one
      const anyBranch = await client.query(
        `SELECT id, name FROM branches WHERE status = 'active' ORDER BY id LIMIT 1`,
      );
      if (anyBranch.rows[0]) {
        branchId = anyBranch.rows[0].id;
        warn(`No "${TEST_BRANCH_NAME}" found — reusing existing branch: "${anyBranch.rows[0].name}" (id=${branchId})`);
      } else {
        const inserted = await client.query(
          `INSERT INTO branches (name, status) VALUES ($1, 'active') RETURNING id`,
          [TEST_BRANCH_NAME],
        );
        branchId = inserted.rows[0].id;
        log(`Created new branch: "${TEST_BRANCH_NAME}" (id=${branchId})`);
      }
    }

    // ── 2. Ensure template roles ───────────────────────────────────────────
    section('Template Roles');

    async function upsertTemplateRole(name: string, displayName: string): Promise<number> {
      const existing = await client.query(
        `SELECT id FROM roles WHERE name = $1 AND is_template = TRUE LIMIT 1`,
        [name],
      );
      if (existing.rows[0]) {
        log(`Role exists: ${name} (id=${existing.rows[0].id})`);
        return existing.rows[0].id;
      }
      const inserted = await client.query(
        `INSERT INTO roles (name, display_name, is_template, is_active)
         VALUES ($1, $2, TRUE, TRUE) RETURNING id`,
        [name, displayName],
      );
      log(`Created role: ${name} (id=${inserted.rows[0].id})`);
      return inserted.rows[0].id;
    }

    const globalRoleId = await upsertTemplateRole(GLOBAL_ROLE_NAME, 'Dev — Global Admin');
    const branchRoleId = await upsertTemplateRole(BRANCH_ROLE_NAME, 'Dev — Branch User');

    // ── 3. Load all existing permissions ──────────────────────────────────
    section('Permission Grants');

    const { rows: allPerms } = await client.query(
      `SELECT id, key FROM permissions ORDER BY key`,
    );
    log(`Found ${allPerms.length} permissions in catalog`);

    // ── 4. DEV_GLOBAL_ADMIN — GLOBAL grants on all permissions ────────────

    // Clear existing grants for this role first (idempotent reset)
    await client.query(`DELETE FROM role_permission_grants WHERE role_id = $1`, [globalRoleId]);
    await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [globalRoleId]);

    if (allPerms.length > 0) {
      const globalGrantValues = allPerms
        .map((_, i) => `($1, $${i + 2}, 'GLOBAL')`)
        .join(', ');
      await client.query(
        `INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
         VALUES ${globalGrantValues}
         ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = 'GLOBAL', updated_at = NOW()`,
        [globalRoleId, ...allPerms.map(p => p.id)],
      );
      const legacyValues = allPerms
        .map((_, i) => `($1, $${i + 2})`)
        .join(', ');
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ${legacyValues}
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [globalRoleId, ...allPerms.map(p => p.id)],
      );
      log(`${GLOBAL_ROLE_NAME}: granted ${allPerms.length} permissions (GLOBAL scope)`);
    }

    // ── 5. DEV_BRANCH_USER — BRANCH grants on selected permissions ────────

    await client.query(`DELETE FROM role_permission_grants WHERE role_id = $1`, [branchRoleId]);
    await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [branchRoleId]);

    const branchPerms = allPerms.filter(p => BRANCH_USER_PERMISSIONS.includes(p.key));
    const missingKeys = BRANCH_USER_PERMISSIONS.filter(k => !allPerms.some(p => p.key === k));
    if (missingKeys.length > 0) {
      warn(`${BRANCH_ROLE_NAME}: ${missingKeys.length} permission(s) not in DB yet (skipped): ${missingKeys.join(', ')}`);
    }

    if (branchPerms.length > 0) {
      const branchGrantValues = branchPerms
        .map((_, i) => `($1, $${i + 2}, 'BRANCH')`)
        .join(', ');
      await client.query(
        `INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
         VALUES ${branchGrantValues}
         ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = 'BRANCH', updated_at = NOW()`,
        [branchRoleId, ...branchPerms.map(p => p.id)],
      );
      const legacyBranchValues = branchPerms
        .map((_, i) => `($1, $${i + 2})`)
        .join(', ');
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ${legacyBranchValues}
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [branchRoleId, ...branchPerms.map(p => p.id)],
      );
      log(`${BRANCH_ROLE_NAME}: granted ${branchPerms.length} permissions (BRANCH scope)`);
    }

    // ── 6. Hash password ───────────────────────────────────────────────────
    section('Password Hashing');

    const passwordHash = await bcrypt.hash(DEV_PASSWORD, BCRYPT_ROUNDS);
    log(`Password hashed with bcrypt (rounds=${BCRYPT_ROUNDS})`);

    // ── 7. Delete existing dev test users (safe — CASCADE on assignments) ──
    section('User Reset');

    for (const username of [GLOBAL_USERNAME, BRANCH_USERNAME]) {
      const deleted = await client.query(
        `DELETE FROM hr_users WHERE username = $1 RETURNING id`,
        [username],
      );
      if (deleted.rows[0]) {
        log(`Deleted existing user: ${username} (id=${deleted.rows[0].id}) — assignments cascade-deleted`);
      }
    }

    // ── 8. Create global_admin ─────────────────────────────────────────────
    section('Create Users');

    const globalUser = await client.query(
      `INSERT INTO hr_users (name, username, password_hash, role, role_id, is_active, is_super_admin)
       VALUES ($1, $2, $3, $4, $5, TRUE, TRUE)
       RETURNING id`,
      ['Global Admin (Dev)', GLOBAL_USERNAME, passwordHash, GLOBAL_ROLE_NAME, globalRoleId],
    );
    const globalUserId = globalUser.rows[0].id;
    log(`Created user: ${GLOBAL_USERNAME} (id=${globalUserId}, role=${GLOBAL_ROLE_NAME})`);

    // ── 9. Create branch_user ──────────────────────────────────────────────

    const branchUser = await client.query(
      `INSERT INTO hr_users (name, username, password_hash, role, role_id, is_active, is_super_admin, branch_id)
       VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, $6)
       RETURNING id`,
      ['Branch User (Dev)', BRANCH_USERNAME, passwordHash, BRANCH_ROLE_NAME, branchRoleId, branchId],
    );
    const branchUserId = branchUser.rows[0].id;
    log(`Created user: ${BRANCH_USERNAME} (id=${branchUserId}, role=${BRANCH_ROLE_NAME})`);

    // ── 10. user_branch_assignments for branch_user ────────────────────────

    await client.query(
      `INSERT INTO user_branch_assignments (user_id, branch_id, is_primary, status)
       VALUES ($1, $2, TRUE, 'active')
       ON CONFLICT (user_id, branch_id) DO UPDATE SET is_primary = TRUE, status = 'active'`,
      [branchUserId, branchId],
    );
    log(`Created branch assignment: branch_user → branch ${branchId} (is_primary=true, status=active)`);

    await client.query('COMMIT');

    // ── Summary ────────────────────────────────────────────────────────────
    console.log('\n==========================================================');
    console.log(' DONE — Login Credentials');
    console.log('==========================================================');
    console.log(`\n  global_admin`);
    console.log(`    username : ${GLOBAL_USERNAME}`);
    console.log(`    password : ${DEV_PASSWORD}`);
    console.log(`    role     : ${GLOBAL_ROLE_NAME} (id=${globalRoleId})`);
    console.log(`    scope    : GLOBAL — all ${allPerms.length} permissions`);
    console.log(`    super    : true (enables branch switcher + HQ/super-admin flows)`);
    console.log(`\n  branch_user`);
    console.log(`    username : ${BRANCH_USERNAME}`);
    console.log(`    password : ${DEV_PASSWORD}`);
    console.log(`    role     : ${BRANCH_ROLE_NAME} (id=${branchRoleId})`);
    console.log(`    scope    : BRANCH — ${branchPerms.length} permissions`);
    console.log(`    branch   : id=${branchId} (is_primary=true)`);
    console.log(`\n  Note: authorization cache TTL is 60 s.`);
    console.log(`        If server is running, wait 60 s or restart it.\n`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n  ✗ ERROR — transaction rolled back');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
