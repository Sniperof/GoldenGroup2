-- ============================================================
-- Migration 025: Clients role grants refinement (Phase 4C)
-- - Replaces the conservative "all roles get all clients.*" grants
--   from migration 024 with a minimal, role-specific grant set.
-- - Scope type stays BRANCH throughout (no scope changes).
-- - Idempotent: safe to run multiple times.
--
-- ROLE NAME ASSUMPTIONS
-- ---------------------
-- Roles in this system are created dynamically via the UI.
-- The names below are derived from:
--   - Code references: ADMIN (migration 013, roles.ts:435),
--                      HR_MANAGER (adminApplications.ts:1149)
--   - Business context: job titles (migration 006),
--                       department types (migration 016)
-- If a role name does not exist in the database, the corresponding
-- statements are no-ops and cause no harm.
--
-- PERMISSION MATRIX (scope_type = BRANCH for all grants)
-- -------------------------------------------------------
-- Role             | view_list | view | create | edit | delete
-- ADMIN            |     ✓     |  ✓   |   ✓    |  ✓   |   ✓
-- BRANCH_MANAGER   |     ✓     |  ✓   |   ✓    |  ✓   |   ✗
-- HR_MANAGER       |     ✓     |  ✓   |   ✗    |  ✗   |   ✗
-- SALES            |     ✓     |  ✓   |   ✓    |  ✓   |   ✗
-- TELEMARKETER     |     ✓     |  ✓   |   ✗    |  ✗   |   ✗
-- TECHNICIAN       |     ✓     |  ✓   |   ✗    |  ✗   |   ✗
-- ACCOUNTANT       |     ✓     |  ✓   |   ✗    |  ✗   |   ✗
-- ============================================================

-- ---------------------------------------------------------------------------
-- Step 1: Remove ALL clients.* grants from ALL template roles.
--         This is the clean-slate step before we re-insert precisely.
-- ---------------------------------------------------------------------------

DELETE FROM role_permission_grants rpg
 USING roles r,
       permissions p
 WHERE rpg.role_id    = r.id
   AND rpg.permission_id = p.id
   AND r.is_template  = TRUE
   AND p.key         LIKE 'clients.%';

DELETE FROM role_permissions rp
 USING roles r,
       permissions p
 WHERE rp.role_id    = r.id
   AND rp.permission_id = p.id
   AND r.is_template  = TRUE
   AND p.key         LIKE 'clients.%';

-- ---------------------------------------------------------------------------
-- Step 2: Re-insert exactly the grants each role should have.
--         Each block targets one role by name and grants the minimal set.
--         ON CONFLICT DO NOTHING makes every block re-runnable.
-- ---------------------------------------------------------------------------

-- ── ADMIN — full access ──────────────────────────────────────────────────────
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view',
    'clients.create',
    'clients.edit',
    'clients.delete'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'ADMIN'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view',
    'clients.create',
    'clients.edit',
    'clients.delete'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── BRANCH_MANAGER — manage but not delete ───────────────────────────────────
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view',
    'clients.create',
    'clients.edit'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'BRANCH_MANAGER'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view',
    'clients.create',
    'clients.edit'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'BRANCH_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── HR_MANAGER — read-only (reference checks only) ───────────────────────────
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'HR_MANAGER'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'HR_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── SALES — create and manage client records ─────────────────────────────────
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view',
    'clients.create',
    'clients.edit'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'SALES'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view',
    'clients.create',
    'clients.edit'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'SALES'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── TELEMARKETER — view only (calls and follow-up) ───────────────────────────
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'TELEMARKETER'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'TELEMARKETER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── TECHNICIAN — view only (client address for visits) ───────────────────────
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'TECHNICIAN'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'TECHNICIAN'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── ACCOUNTANT — view only (client data for contracts and dues) ───────────────
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'ACCOUNTANT'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN (
    'clients.view_list',
    'clients.view'
  )
 WHERE r.is_template = TRUE
   AND r.name        = 'ACCOUNTANT'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verification query (run manually after migration to confirm state):
-- ---------------------------------------------------------------------------
-- SELECT r.name AS role_name, p.key AS permission, rpg.scope_type
--   FROM role_permission_grants rpg
--   JOIN roles r       ON r.id  = rpg.role_id
--   JOIN permissions p ON p.id  = rpg.permission_id
--  WHERE r.is_template = TRUE
--    AND p.key LIKE 'clients.%'
--  ORDER BY r.name, p.key;
