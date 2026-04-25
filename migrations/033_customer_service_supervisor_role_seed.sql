-- ============================================================
-- Migration 033: Customer Service Supervisor role seed
--
-- Purpose:
--   1. Ensures CUSTOMER_SERVICE_SUPERVISOR template role exists.
--      On production: the role already exists — the DO block is a no-op.
--      On staging / fresh envs: the role is created from scratch.
--
--   2. Seeds its canonical grants in role_permission_grants with
--      precise scope types (ASSIGNED / BRANCH / GLOBAL).
--      ON CONFLICT DO UPDATE keeps scopes correct on re-runs.
--
--   3. Keeps the legacy role_permissions table in sync for
--      backwards-compatibility with code paths that still read it.
--
--   4. Repairs clients.* grants for SYSTEM_ADMIN that migration 025
--      deletes on staging / fresh envs (025 does a clean-slate DELETE
--      then re-inserts only a hardcoded role name list that does NOT
--      include SYSTEM_ADMIN). On production, 025 was registered-only
--      so no repair is needed — but the ON CONFLICT path is harmless.
--
--   5. Repairs clients.view_list / clients.view (read-only) for
--      HR_ASSISTANT for the same reason. Silently skips if the role
--      does not exist in the target environment.
--
-- Idempotent: safe to run multiple times on any environment.
-- No hardcoded IDs: all lookups use role names and permission keys.
-- No deletes: never removes existing grants or roles.
-- No user changes: does not touch hr_users.
-- No clones: only creates / updates a template (branch_id = NULL).
-- ============================================================


-- ── 1. Ensure CUSTOMER_SERVICE_SUPERVISOR template role ───────────────────────
--
-- Matches on (name, is_template=TRUE, branch_id IS NULL) — the only
-- combination that uniquely identifies a canonical template since
-- migration 013 dropped the simple UNIQUE(name) constraint and replaced
-- it with UNIQUE(name, COALESCE(branch_id, 0)).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM roles
     WHERE name        = 'CUSTOMER_SERVICE_SUPERVISOR'
       AND is_template = TRUE
       AND branch_id   IS NULL
  ) THEN
    INSERT INTO roles (
      name,
      display_name,
      description,
      is_system,
      is_active,
      is_template,
      branch_id,
      template_id,
      is_protected,
      is_hidden
    ) VALUES (
      'CUSTOMER_SERVICE_SUPERVISOR',
      'مشرفة خدمة زبائن',
      'دور مشرفة خدمة الزبائن — صلاحيات إدارة العملاء والمرشحين ضمن نطاق الفرع والتكليف',
      FALSE,  -- not a system role
      TRUE,   -- active
      TRUE,   -- template (never a branch clone)
      NULL,   -- no branch binding
      NULL,   -- not derived from another template
      FALSE,  -- not protected from deletion
      FALSE   -- visible in the roles management UI
    );
  END IF;
END $$;


-- ── 2. Grant permissions to CUSTOMER_SERVICE_SUPERVISOR ──────────────────────
--
-- Scope rationale:
--   ASSIGNED — the user sees / edits only clients explicitly assigned to her.
--   BRANCH   — the user can create / list records scoped to her branch.
--   GLOBAL   — read-only reference data needed for form dropdowns (geo, lists).

INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, g.scope_type
  FROM (VALUES
    ('clients.view_list',       'ASSIGNED'),
    ('clients.view',            'ASSIGNED'),
    ('clients.view_detail',     'ASSIGNED'),
    ('clients.create',          'BRANCH'),
    ('clients.edit',            'ASSIGNED'),
    ('geo.view',                'GLOBAL'),
    ('admin.system_lists.view', 'GLOBAL'),
    ('candidates.view_list',    'BRANCH'),
    ('candidates.create',       'BRANCH'),
    ('candidates.edit',         'BRANCH')
  ) AS g(pkey, scope_type)
  JOIN permissions p ON p.key = g.pkey
  JOIN roles       r ON r.name        = 'CUSTOMER_SERVICE_SUPERVISOR'
                    AND r.is_template = TRUE
                    AND r.branch_id   IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

-- Legacy compatibility table — kept in sync with role_permission_grants.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM (VALUES
    ('clients.view_list'),
    ('clients.view'),
    ('clients.view_detail'),
    ('clients.create'),
    ('clients.edit'),
    ('geo.view'),
    ('admin.system_lists.view'),
    ('candidates.view_list'),
    ('candidates.create'),
    ('candidates.edit')
  ) AS g(pkey)
  JOIN permissions p ON p.key = g.pkey
  JOIN roles       r ON r.name        = 'CUSTOMER_SERVICE_SUPERVISOR'
                    AND r.is_template = TRUE
                    AND r.branch_id   IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- ── 3. Repair SYSTEM_ADMIN clients.* grants ───────────────────────────────────
--
-- Migration 025 performs a clean-slate DELETE of all clients.* grants from
-- every template role and then re-inserts only a hardcoded set of role names.
-- SYSTEM_ADMIN is NOT in that list, so on staging / fresh envs where 025 runs
-- for real, SYSTEM_ADMIN loses all clients.* access.
--
-- Fix: grant all clients.* permissions to SYSTEM_ADMIN with GLOBAL scope.
-- On production where 025 was registered-only, SYSTEM_ADMIN already has these
-- grants — the ON CONFLICT path is a safe no-op.

INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles       r
  JOIN permissions p ON p.key LIKE 'clients.%'
 WHERE r.name        = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id   IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles       r
  JOIN permissions p ON p.key LIKE 'clients.%'
 WHERE r.name        = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id   IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- ── 4. Repair HR_ASSISTANT basic client read grants ───────────────────────────
--
-- Migration 025 also removes clients.* from HR_ASSISTANT because it is not in
-- the hardcoded re-insert list. HR_ASSISTANT should retain read-only access
-- (view_list + view) for reference lookups.
--
-- Silently skips if HR_ASSISTANT template does not exist in this environment.

INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles       r
  JOIN permissions p ON p.key IN ('clients.view_list', 'clients.view')
 WHERE r.name        = 'HR_ASSISTANT'
   AND r.is_template = TRUE
   AND r.branch_id   IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles       r
  JOIN permissions p ON p.key IN ('clients.view_list', 'clients.view')
 WHERE r.name        = 'HR_ASSISTANT'
   AND r.is_template = TRUE
   AND r.branch_id   IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- ── Verification queries (run manually after applying) ────────────────────────
--
-- 1. Role exists as template:
-- SELECT id, name, display_name, is_template, is_system, is_hidden, branch_id
--   FROM roles
--  WHERE name = 'CUSTOMER_SERVICE_SUPERVISOR';
--
-- 2. CSS grants with correct scopes:
-- SELECT p.key, rpg.scope_type
--   FROM role_permission_grants rpg
--   JOIN roles       r ON r.id  = rpg.role_id
--   JOIN permissions p ON p.id  = rpg.permission_id
--  WHERE r.name        = 'CUSTOMER_SERVICE_SUPERVISOR'
--    AND r.is_template = TRUE
--    AND r.branch_id   IS NULL
--  ORDER BY p.key;
--
-- 3. SYSTEM_ADMIN retains clients.* GLOBAL:
-- SELECT p.key, rpg.scope_type
--   FROM role_permission_grants rpg
--   JOIN roles       r ON r.id  = rpg.role_id
--   JOIN permissions p ON p.id  = rpg.permission_id
--  WHERE r.name        = 'SYSTEM_ADMIN'
--    AND r.is_template = TRUE
--    AND r.branch_id   IS NULL
--    AND p.key LIKE    'clients.%'
--  ORDER BY p.key;
--
-- 4. HR_ASSISTANT has read-only clients access:
-- SELECT p.key, rpg.scope_type
--   FROM role_permission_grants rpg
--   JOIN roles       r ON r.id  = rpg.role_id
--   JOIN permissions p ON p.id  = rpg.permission_id
--  WHERE r.name        = 'HR_ASSISTANT'
--    AND r.is_template = TRUE
--    AND r.branch_id   IS NULL
--    AND p.key LIKE    'clients.%'
--  ORDER BY p.key;
