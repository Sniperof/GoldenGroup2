/**
 * DEV / TEST ONLY — Single Super Admin Clean Baseline Reset
 *
 * Phase Z0.2: Establishes the minimum clean baseline for a fresh start:
 *
 *   ✓ One active user:   superadmin / Password123!  (is_super_admin = true)
 *   ✓ One active branch: فرع دمشق
 *   ✓ One role:          SYSTEM_ADMIN (template, protected, hidden — created by migration 029)
 *   ✓ Branch assignment: superadmin → فرع دمشق (is_primary = true)
 *
 * What this script does NOT touch:
 *   - permissions catalog                  (untouched)
 *   - role_permission_grants               (untouched)
 *   - authorization logic / AuthContext    (untouched)
 *   - any table structure                  (only DML, no DDL)
 *
 * Destructive actions (on non-superadmin data only):
 *   - Deactivates all hr_users except superadmin (is_active = false)
 *   - Deactivates all user_branch_assignments for deactivated users
 *   - Marks all non-system business roles as is_hidden = true
 *   - Sets all branches except فرع دمشق to status = 'inactive'
 *
 * Run with:
 *   cd packages/api && tsx dev-reset-single-superadmin.ts
 *
 * SAFETY: Aborts immediately if APP_ENV or NODE_ENV looks like production.
 */

import bcrypt from 'bcryptjs';
import pool from './db.js';

// ── Config ──────────────────────────────────────────────────────────────────

const SUPERADMIN_USERNAME  = 'superadmin';
const SUPERADMIN_NAME      = 'Super Admin';
const SUPERADMIN_PASSWORD  = 'Password123!';
const BCRYPT_ROUNDS        = 10;

const SYSTEM_ADMIN_ROLE_NAME = 'SYSTEM_ADMIN';
const DAMASCUS_BRANCH_NAME   = 'فرع دمشق';

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string)     { console.log(`  ✓ ${msg}`); }
function warn(msg: string)    { console.log(`  ⚠ ${msg}`); }
function section(t: string)   { console.log(`\n── ${t}`); }
function abort(msg: string)   { console.error(`\n  ✗ ABORT: ${msg}\n`); process.exit(1); }

// ── Environment Guard ────────────────────────────────────────────────────────

function assertNotProduction() {
  const env = (process.env.APP_ENV ?? process.env.NODE_ENV ?? '').toLowerCase().trim();

  const looksLikeProd =
    env === 'production' ||
    env === 'prod' ||
    env === 'staging' ||  // staging also treated as off-limits
    (process.env.DATABASE_URL ?? '').includes('prod');

  if (looksLikeProd) {
    abort(
      `Environment looks like production (APP_ENV=${process.env.APP_ENV ?? '—'}, ` +
      `NODE_ENV=${process.env.NODE_ENV ?? '—'}). ` +
      `This script must never run against production.`,
    );
  }

  if (!env || env === '') {
    warn(
      `APP_ENV and NODE_ENV are both unset. ` +
      `Proceeding because DATABASE_URL does not contain "prod". ` +
      `Verify you are on a dev/test database before continuing.`,
    );
  } else {
    log(`Environment: ${env} — safe to proceed`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n==========================================================');
  console.log(' Z0.2 — CLEAN BASELINE RESET — golden-crm');
  console.log('==========================================================');
  console.log(' Dev/test environment only. See script header for details.');

  // ── 0. Environment guard ────────────────────────────────────────────────
  section('Environment Check');
  assertNotProduction();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Verify SYSTEM_ADMIN role ────────────────────────────────────────
    section('Verify SYSTEM_ADMIN Role');

    const { rows: saRows } = await client.query(
      `SELECT id, name, is_system, is_protected, is_hidden, is_template
         FROM roles
        WHERE name = $1
        LIMIT 1`,
      [SYSTEM_ADMIN_ROLE_NAME],
    );

    if (!saRows[0]) {
      abort(
        `Role "${SYSTEM_ADMIN_ROLE_NAME}" not found. ` +
        `Run migration 029 first: psql $DATABASE_URL -f migrations/029_system_admin_role_protection.sql`,
      );
    }

    const saRole = saRows[0];

    if (!saRole.is_template) {
      abort(`SYSTEM_ADMIN exists but is_template = false. Check migration 029.`);
    }
    if (!saRole.is_protected) {
      abort(`SYSTEM_ADMIN exists but is_protected = false. Check migration 029.`);
    }
    if (!saRole.is_hidden) {
      abort(`SYSTEM_ADMIN exists but is_hidden = false. Check migration 029.`);
    }

    const systemAdminRoleId: number = saRole.id;

    // Verify it has GLOBAL grants
    const { rows: grantRows } = await client.query(
      `SELECT COUNT(*) AS cnt
         FROM role_permission_grants
        WHERE role_id = $1 AND scope_type = 'GLOBAL'`,
      [systemAdminRoleId],
    );
    const grantCount = parseInt(grantRows[0].cnt as string);
    if (grantCount === 0) {
      abort(
        `SYSTEM_ADMIN has no GLOBAL permission grants. ` +
        `Re-run migration 029 to seed the grants.`,
      );
    }

    log(`SYSTEM_ADMIN role verified (id=${systemAdminRoleId}, ${grantCount} GLOBAL grants)`);

    // ── 2. Deactivate all existing hr_users (except the superadmin we'll create) ──
    section('Deactivate Existing Users');

    // Deactivate everyone first; we will create/re-activate superadmin below.
    const deactivated = await client.query(
      `UPDATE hr_users
          SET is_active = FALSE
        WHERE username != $1
        RETURNING id, username`,
      [SUPERADMIN_USERNAME],
    );
    if (deactivated.rows.length > 0) {
      log(`Deactivated ${deactivated.rows.length} user(s): ${deactivated.rows.map(r => r.username).join(', ')}`);
    } else {
      log(`No other users to deactivate`);
    }

    // Also deactivate any existing superadmin so we can re-create cleanly
    await client.query(
      `UPDATE hr_users SET is_active = FALSE WHERE username = $1`,
      [SUPERADMIN_USERNAME],
    );

    // ── 3. Deactivate branch assignments for deactivated users ────────────
    section('Clean User Branch Assignments');

    const deactivatedUserIds = deactivated.rows.map(r => r.id);

    // Also grab the current superadmin id if it already exists
    const { rows: existingSa } = await client.query(
      `SELECT id FROM hr_users WHERE username = $1`,
      [SUPERADMIN_USERNAME],
    );
    const existingSaId: number | null = existingSa[0]?.id ?? null;

    // Deactivate assignments for all users that were deactivated
    if (deactivatedUserIds.length > 0) {
      const { rowCount } = await client.query(
        `UPDATE user_branch_assignments
            SET status = 'inactive'
          WHERE user_id = ANY($1)`,
        [deactivatedUserIds],
      );
      log(`Deactivated ${rowCount ?? 0} branch assignment(s) for deactivated users`);
    }

    // Also clean any old assignments for the superadmin account (will be re-created below)
    if (existingSaId != null) {
      await client.query(
        `UPDATE user_branch_assignments SET status = 'inactive' WHERE user_id = $1`,
        [existingSaId],
      );
      log(`Cleared existing branch assignments for superadmin (will be re-created)`);
    }

    // ── 4. Mark non-system roles as is_hidden ──────────────────────────────
    section('Hide Legacy Roles');

    // We only hide roles that are not already system roles.
    // SYSTEM_ADMIN (is_system = true) stays as-is.
    // DEV_ roles are already filtered in the list query, but we'll mark them too.
    const { rows: hiddenRoles } = await client.query(
      `UPDATE roles
          SET is_hidden = TRUE
        WHERE is_system = FALSE
          AND is_hidden = FALSE
        RETURNING name`,
    );
    if (hiddenRoles.length > 0) {
      log(`Marked ${hiddenRoles.length} role(s) as hidden: ${hiddenRoles.map(r => r.name).join(', ')}`);
    } else {
      log(`No non-system roles to hide`);
    }

    // ── 5. Ensure فرع دمشق branch ─────────────────────────────────────────
    section(`Branch: ${DAMASCUS_BRANCH_NAME}`);

    let damascusBranchId: number;

    const { rows: damRows } = await client.query(
      `SELECT id FROM branches WHERE name = $1 LIMIT 1`,
      [DAMASCUS_BRANCH_NAME],
    );
    if (damRows[0]) {
      damascusBranchId = damRows[0].id;
      // Ensure it is active
      await client.query(
        `UPDATE branches SET status = 'active' WHERE id = $1`,
        [damascusBranchId],
      );
      log(`Using existing branch: "${DAMASCUS_BRANCH_NAME}" (id=${damascusBranchId}) — set to active`);
    } else {
      const inserted = await client.query(
        `INSERT INTO branches (name, status) VALUES ($1, 'active') RETURNING id`,
        [DAMASCUS_BRANCH_NAME],
      );
      damascusBranchId = inserted.rows[0].id;
      log(`Created new branch: "${DAMASCUS_BRANCH_NAME}" (id=${damascusBranchId})`);
    }

    // ── 6. Deactivate all other branches (safe — not deleting) ────────────

    const { rows: deactivatedBranches } = await client.query(
      `UPDATE branches
          SET status = 'inactive'
        WHERE id != $1
          AND status = 'active'
        RETURNING name`,
      [damascusBranchId],
    );
    if (deactivatedBranches.length > 0) {
      warn(
        `Deactivated ${deactivatedBranches.length} other branch(es): ` +
        deactivatedBranches.map(b => b.name).join(', ') +
        ' — data preserved, FK constraints intact',
      );
    } else {
      log(`No other active branches to deactivate`);
    }

    // ── 7. Hash password ───────────────────────────────────────────────────
    section('Password');

    const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD, BCRYPT_ROUNDS);
    log(`Password hashed (bcrypt, rounds=${BCRYPT_ROUNDS})`);

    // ── 8. Upsert superadmin user ──────────────────────────────────────────
    section('Create / Update Superadmin User');

    let superAdminUserId: number;

    if (existingSaId != null) {
      // Update the existing account fully
      await client.query(
        `UPDATE hr_users
            SET name          = $1,
                password_hash = $2,
                role          = $3,
                role_id       = $4,
                is_active     = TRUE,
                is_super_admin = TRUE,
                branch_id     = $5
          WHERE id = $6`,
        [SUPERADMIN_NAME, passwordHash, SYSTEM_ADMIN_ROLE_NAME, systemAdminRoleId, damascusBranchId, existingSaId],
      );
      superAdminUserId = existingSaId;
      log(`Updated existing user: ${SUPERADMIN_USERNAME} (id=${superAdminUserId})`);
    } else {
      const { rows } = await client.query(
        `INSERT INTO hr_users
           (name, username, password_hash, role, role_id, is_active, is_super_admin, branch_id)
         VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, $6)
         RETURNING id`,
        [SUPERADMIN_NAME, SUPERADMIN_USERNAME, passwordHash, SYSTEM_ADMIN_ROLE_NAME, systemAdminRoleId, damascusBranchId],
      );
      superAdminUserId = rows[0].id;
      log(`Created new user: ${SUPERADMIN_USERNAME} (id=${superAdminUserId})`);
    }

    // ── 9. user_branch_assignments for superadmin → Damascus ──────────────
    section('Branch Assignment');

    await client.query(
      `INSERT INTO user_branch_assignments (user_id, branch_id, is_primary, status)
       VALUES ($1, $2, TRUE, 'active')
       ON CONFLICT (user_id, branch_id)
       DO UPDATE SET is_primary = TRUE, status = 'active', updated_at = NOW()`,
      [superAdminUserId, damascusBranchId],
    );
    log(`Branch assignment: ${SUPERADMIN_USERNAME} → "${DAMASCUS_BRANCH_NAME}" (is_primary=true, status=active)`);

    // ── 10. Commit ─────────────────────────────────────────────────────────
    await client.query('COMMIT');

    // ── 11. Post-commit verification ───────────────────────────────────────
    section('Verification');

    const { rows: activeUsers } = await pool.query(
      `SELECT u.id, u.username, u.is_super_admin, u.is_active, r.name AS role_name
         FROM hr_users u
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.is_active = TRUE`,
    );
    log(`Active users after reset: ${activeUsers.length}`);
    for (const u of activeUsers) {
      log(`  → ${u.username} (id=${u.id}, super=${u.is_super_admin}, role=${u.role_name ?? '—'})`);
    }

    const { rows: activeBranches } = await pool.query(
      `SELECT id, name FROM branches WHERE status = 'active'`,
    );
    log(`Active branches after reset: ${activeBranches.length}`);
    for (const b of activeBranches) {
      log(`  → ${b.name} (id=${b.id})`);
    }

    const { rows: visibleRoles } = await pool.query(
      `SELECT name, is_hidden, is_protected FROM roles WHERE is_template = TRUE ORDER BY is_hidden, name`,
    );
    log(`Template roles (all):`);
    for (const r of visibleRoles) {
      log(`  → ${r.name} hidden=${r.is_hidden} protected=${r.is_protected}`);
    }

    if (activeUsers.length !== 1) {
      warn(`Expected exactly 1 active user but found ${activeUsers.length}. Review above.`);
    }
    if (activeBranches.length !== 1) {
      warn(`Expected exactly 1 active branch but found ${activeBranches.length}. Review above.`);
    }

    // ── Summary ────────────────────────────────────────────────────────────
    console.log('\n==========================================================');
    console.log(' DONE — Clean Baseline Ready');
    console.log('==========================================================');
    console.log(`\n  Super Admin Login`);
    console.log(`    username   : ${SUPERADMIN_USERNAME}`);
    console.log(`    password   : ${SUPERADMIN_PASSWORD}`);
    console.log(`    user id    : ${superAdminUserId}`);
    console.log(`    role       : ${SYSTEM_ADMIN_ROLE_NAME} (id=${systemAdminRoleId})`);
    console.log(`    is_super   : true`);
    console.log(`    grants     : GLOBAL × ${grantCount} permissions`);
    console.log(`\n  Acting Branch`);
    console.log(`    name       : ${DAMASCUS_BRANCH_NAME}`);
    console.log(`    branch id  : ${damascusBranchId}`);
    console.log(`    assignment : is_primary=true, status=active`);
    console.log(`\n  Notes`);
    console.log(`    • All other users are deactivated (data preserved)`);
    console.log(`    • All other branches are inactive  (data preserved)`);
    console.log(`    • All non-system roles are hidden  (data preserved)`);
    console.log(`    • permissions catalog untouched`);
    console.log(`    • Authorization cache TTL is 60 s.`);
    console.log(`      If server is running, wait 60 s or restart it.`);
    console.log(`\n  Next Steps for Product Owner`);
    console.log(`    1. Log in as superadmin`);
    console.log(`    2. Create business roles from /admin/roles`);
    console.log(`    3. Set permissions + scope per role`);
    console.log(`    4. Create users and assign roles + branches`);
    console.log(`    5. Verify login with each user\n`);

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
