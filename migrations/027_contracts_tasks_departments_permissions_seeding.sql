-- ============================================================
-- Migration 027: Contracts, tasks, and departments permissions seeding (Phase H4.1)
-- - Adds permission keys required after migrating legacy routes
--   (contracts GET/PUT/DELETE, tasks GET/PUT/DELETE, departments GET)
--   from req.scope to the official authorization pipeline.
-- - Grants conservatively to all template roles with BRANCH scope.
--   A future refinement migration can tighten per-role grants.
-- - Idempotent: safe to run multiple times.
-- ============================================================

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('contracts.view_list', 'contracts', 'contracts', 'view_list', 'عرض قائمة العقود',  10),
  ('contracts.edit',      'contracts', 'contracts', 'edit',      'تعديل عقد',          30),
  ('contracts.delete',    'contracts', 'contracts', 'delete',    'حذف عقد',            40),
  ('tasks.view_list',     'tasks',     'tasks',     'view_list', 'عرض قائمة المهام',   10),
  ('tasks.edit',          'tasks',     'tasks',     'edit',      'تعديل مهمة',          30),
  ('tasks.delete',        'tasks',     'tasks',     'delete',    'حذف مهمة',            40),
  ('departments.view_list','departments','departments','view_list','عرض قائمة الأقسام', 10)
ON CONFLICT (key) DO NOTHING;

-- ── role_permissions (legacy table — kept in sync) ──────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN (
    'contracts.view_list', 'contracts.edit', 'contracts.delete',
    'tasks.view_list', 'tasks.edit', 'tasks.delete',
    'departments.view_list'
  )
 WHERE r.is_template = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── role_permission_grants (canonical table read by runtime) ─────────────────
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key IN (
    'contracts.view_list', 'contracts.edit', 'contracts.delete',
    'tasks.view_list', 'tasks.edit', 'tasks.delete',
    'departments.view_list'
  )
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
--    AND p.key IN (
--      'contracts.view_list', 'contracts.edit', 'contracts.delete',
--      'tasks.view_list', 'tasks.edit', 'tasks.delete',
--      'departments.view_list'
--    )
--  ORDER BY r.name, p.key;
