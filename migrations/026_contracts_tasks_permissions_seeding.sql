-- ============================================================
-- Migration 026: Contracts and tasks permissions seeding (Phase H2.1)
-- - Adds minimal permission keys required to authorize the
--   contracts.create and tasks.create routes after H2 hardening.
-- - Grants conservatively to all template roles with BRANCH scope.
--   A future refinement migration can tighten per-role grants.
-- - Idempotent: safe to run multiple times.
-- ============================================================

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('contracts.create', 'contracts', 'contracts', 'create', 'إنشاء عقد',  10),
  ('tasks.create',     'tasks',     'tasks',     'create', 'إنشاء مهمة', 10)
ON CONFLICT (key) DO NOTHING;

-- ── role_permissions (legacy table — kept in sync) ──────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN ('contracts.create', 'tasks.create')
 WHERE r.is_template = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── role_permission_grants (canonical table read by runtime) ─────────────────
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key IN ('contracts.create', 'tasks.create')
 WHERE r.is_template = TRUE
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

-- ---------------------------------------------------------------------------
-- Verification query (run manually to confirm state):
-- ---------------------------------------------------------------------------
-- SELECT r.name, p.key, rpg.scope_type
--   FROM role_permission_grants rpg
--   JOIN roles r       ON r.id = rpg.role_id
--   JOIN permissions p ON p.id = rpg.permission_id
--  WHERE r.is_template = TRUE
--    AND p.key IN ('contracts.create', 'tasks.create')
--  ORDER BY r.name, p.key;
