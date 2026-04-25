/**
 * DEV / TEST ONLY — Hard-delete all roles & users except the canonical baseline
 *
 * Keeps:
 *   ✓ Role  : SYSTEM_ADMIN  (is_template = TRUE, branch_id IS NULL)
 *   ✓ User  : superadmin    (username = 'superadmin')
 *
 * Deletes (hard DELETE, not deactivation):
 *   ✗ All other hr_users           → cascades to user_branch_assignments
 *   ✗ All other roles              → cascades to role_permissions, role_permission_grants
 *                                    SET NULL on system_lists.linked_role_id + roles.template_id
 *
 * Order matters:
 *   1. DELETE users first  (removes hr_users.role_id FK references to non-SYSTEM_ADMIN roles)
 *   2. DELETE roles second (no remaining FK blockers)
 *
 * Run with:
 *   cd packages/api && tsx dev-purge-roles-users.ts
 *
 * SAFETY: Aborts immediately if APP_ENV or NODE_ENV looks like production.
 */

import pool from './db.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string)   { console.log(`  ✓ ${msg}`); }
function warn(msg: string)  { console.log(`  ⚠ ${msg}`); }
function section(t: string) { console.log(`\n── ${t}`); }
function abort(msg: string) { console.error(`\n  ✗ ABORT: ${msg}\n`); process.exit(1); }

// ── Environment Guard ────────────────────────────────────────────────────────

function assertNotProduction() {
  const env = (process.env.APP_ENV ?? process.env.NODE_ENV ?? '').toLowerCase().trim();

  const looksLikeProd =
    env === 'production' ||
    env === 'prod'       ||
    env === 'staging'    ||
    (process.env.DATABASE_URL ?? '').includes('prod');

  if (looksLikeProd) {
    abort(
      `Environment looks like production (APP_ENV=${process.env.APP_ENV ?? '—'}, ` +
      `NODE_ENV=${process.env.NODE_ENV ?? '—'}). ` +
      `This script must never run against production.`,
    );
  }

  log(`Environment: ${env || 'unset (dev assumed)'} — safe to proceed`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n==========================================================');
  console.log(' DEV PURGE — Delete all roles & users except baseline');
  console.log('==========================================================');
  console.log(' Keeps: role=SYSTEM_ADMIN, user=superadmin. Deletes everything else.');

  section('Environment Check');
  assertNotProduction();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Pre-flight: confirm baseline exists ───────────────────────────────

    section('Pre-flight Check');

    const { rows: saRoleRows } = await client.query(
      `SELECT id, name FROM roles
        WHERE name = 'SYSTEM_ADMIN' AND is_template = TRUE AND branch_id IS NULL
        LIMIT 1`,
    );
    if (!saRoleRows[0]) {
      abort('SYSTEM_ADMIN template role not found. Run migration 029 first.');
    }
    const systemAdminRoleId: number = saRoleRows[0].id;
    log(`SYSTEM_ADMIN role found (id=${systemAdminRoleId})`);

    const { rows: saUserRows } = await client.query(
      `SELECT id, username FROM hr_users WHERE username = 'superadmin' LIMIT 1`,
    );
    if (!saUserRows[0]) {
      abort('superadmin user not found. Run dev-reset-single-superadmin.ts first.');
    }
    const superAdminUserId: number = saUserRows[0].id;
    log(`superadmin user found (id=${superAdminUserId})`);

    // ── 1. Count what will be deleted ─────────────────────────────────────

    const { rows: userCount } = await client.query(
      `SELECT COUNT(*) AS cnt FROM hr_users WHERE id != $1`,
      [superAdminUserId],
    );
    const { rows: roleCount } = await client.query(
      `SELECT COUNT(*) AS cnt FROM roles WHERE id != $1`,
      [systemAdminRoleId],
    );
    warn(`Will DELETE ${userCount[0].cnt} user(s) and ${roleCount[0].cnt} role(s)`);

    // ── 2. DELETE all users except superadmin ─────────────────────────────
    // Cascades automatically:
    //   • user_branch_assignments  (ON DELETE CASCADE)
    // SET NULL automatically:
    //   • referral_sheets.assigned_hr_user_id  (ON DELETE SET NULL)

    section('Delete Users');

    const { rows: deletedUsers } = await client.query(
      `DELETE FROM hr_users
        WHERE id != $1
        RETURNING id, username`,
      [superAdminUserId],
    );

    if (deletedUsers.length > 0) {
      log(`Deleted ${deletedUsers.length} user(s): ${deletedUsers.map(u => u.username).join(', ')}`);
    } else {
      log('No users to delete');
    }

    // ── 3. DELETE all roles except SYSTEM_ADMIN template ─────────────────
    // Cascades automatically:
    //   • role_permissions         (ON DELETE CASCADE)
    //   • role_permission_grants   (ON DELETE CASCADE)
    // SET NULL automatically:
    //   • system_lists.linked_role_id  (ON DELETE SET NULL)
    //   • roles.template_id (self-ref)  (ON DELETE SET NULL)

    section('Delete Roles');

    const { rows: deletedRoles } = await client.query(
      `DELETE FROM roles
        WHERE id != $1
        RETURNING id, name, is_template, branch_id`,
      [systemAdminRoleId],
    );

    if (deletedRoles.length > 0) {
      log(`Deleted ${deletedRoles.length} role(s):`);
      for (const r of deletedRoles) {
        log(`  → ${r.name} (id=${r.id}, template=${r.is_template}, branch=${r.branch_id ?? 'NULL'})`);
      }
    } else {
      log('No roles to delete');
    }

    // ── 4. Commit ─────────────────────────────────────────────────────────

    await client.query('COMMIT');

    // ── 5. Post-commit verification ───────────────────────────────────────

    section('Verification');

    const { rows: remainingUsers } = await pool.query(
      `SELECT u.id, u.username, u.is_super_admin, u.is_active,
              r.name AS role_name
         FROM hr_users u
         LEFT JOIN roles r ON r.id = u.role_id
         ORDER BY u.id`,
    );
    log(`Remaining users: ${remainingUsers.length}`);
    for (const u of remainingUsers) {
      log(`  → ${u.username} (id=${u.id}, super=${u.is_super_admin}, active=${u.is_active}, role=${u.role_name ?? '—'})`);
    }

    const { rows: remainingRoles } = await pool.query(
      `SELECT id, name, is_template, is_protected, is_hidden, branch_id
         FROM roles
         ORDER BY id`,
    );
    log(`Remaining roles: ${remainingRoles.length}`);
    for (const r of remainingRoles) {
      log(`  → ${r.name} (id=${r.id}, template=${r.is_template}, protected=${r.is_protected}, hidden=${r.is_hidden}, branch=${r.branch_id ?? 'NULL'})`);
    }

    // ── Summary ────────────────────────────────────────────────────────────

    console.log('\n==========================================================');
    console.log(' DONE — Purge Complete');
    console.log('==========================================================');
    console.log(`\n  Kept`);
    console.log(`    user  : superadmin (id=${superAdminUserId})`);
    console.log(`    role  : SYSTEM_ADMIN (id=${systemAdminRoleId})`);
    console.log(`\n  Deleted`);
    console.log(`    users : ${deletedUsers.length}`);
    console.log(`    roles : ${deletedRoles.length}`);
    console.log(`\n  Cascaded deletions`);
    console.log(`    • user_branch_assignments for deleted users`);
    console.log(`    • role_permissions + role_permission_grants for deleted roles`);
    console.log(`    • system_lists.linked_role_id SET NULL where applicable`);
    console.log();

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
