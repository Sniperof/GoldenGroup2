-- ============================================================
-- Migration 030: Central admin permissions seeding
-- - Ensures central administration permission keys exist with
--   stable metadata.
-- - Grants them to the canonical SYSTEM_ADMIN template role
--   with GLOBAL scope in role_permission_grants.
-- - Keeps role_permissions in sync for legacy compatibility.
-- - Idempotent: safe to run multiple times.
-- ============================================================

-- ── 1. Ensure permission catalog entries exist ─────────────────────────────
INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('admin.roles.view', 'admin', 'roles', 'view', 'عرض الأدوار', 40),
  ('admin.roles.manage', 'admin', 'roles', 'manage', 'إدارة الأدوار', 41),
  ('admin.system_lists.view', 'admin', 'system_lists', 'view', 'عرض القوائم النظامية', 42),
  ('admin.system_lists.manage', 'admin', 'system_lists', 'manage', 'إدارة القوائم النظامية', 43),
  ('branches.view', 'branches', 'management', 'view', 'عرض الفروع', 190),
  ('branches.manage', 'branches', 'management', 'manage', 'إدارة الفروع', 191),
  ('geo.view', 'geo', 'geography', 'view', 'عرض المناطق الجغرافية', 180),
  ('geo.manage', 'geo', 'geography', 'manage', 'إدارة المناطق والمستويات', 181),
  ('settings.view', 'settings', 'system', 'view', 'عرض إعدادات النظام', 200),
  ('settings.manage', 'settings', 'system', 'manage', 'تعديل إعدادات النظام', 201)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      sub_module = EXCLUDED.sub_module,
      action = EXCLUDED.action,
      display_name = EXCLUDED.display_name,
      display_order = EXCLUDED.display_order;

-- ── 2. Grant canonical SYSTEM_ADMIN all central admin permissions globally ──
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p
    ON p.key IN (
      'admin.roles.view',
      'admin.roles.manage',
      'admin.system_lists.view',
      'admin.system_lists.manage',
      'branches.view',
      'branches.manage',
      'geo.view',
      'geo.manage',
      'settings.view',
      'settings.manage'
    )
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

-- ── 3. Keep legacy compatibility table in sync ─────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.key IN (
      'admin.roles.view',
      'admin.roles.manage',
      'admin.system_lists.view',
      'admin.system_lists.manage',
      'branches.view',
      'branches.manage',
      'geo.view',
      'geo.manage',
      'settings.view',
      'settings.manage'
    )
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── Verification helpers (manual) ──────────────────────────────────────────
-- Missing permission keys:
-- SELECT ARRAY(
--   SELECT missing.key
--   FROM unnest(ARRAY[
--     'admin.roles.view',
--     'admin.roles.manage',
--     'admin.system_lists.view',
--     'admin.system_lists.manage',
--     'branches.view',
--     'branches.manage',
--     'geo.view',
--     'geo.manage',
--     'settings.view',
--     'settings.manage'
--   ]) AS missing(key)
--   WHERE NOT EXISTS (
--     SELECT 1 FROM permissions p WHERE p.key = missing.key
--   )
-- ) AS missing_permissions;
--
-- Missing SYSTEM_ADMIN GLOBAL grants:
-- SELECT ARRAY(
--   SELECT missing.key
--   FROM unnest(ARRAY[
--     'admin.roles.view',
--     'admin.roles.manage',
--     'admin.system_lists.view',
--     'admin.system_lists.manage',
--     'branches.view',
--     'branches.manage',
--     'geo.view',
--     'geo.manage',
--     'settings.view',
--     'settings.manage'
--   ]) AS missing(key)
--   WHERE NOT EXISTS (
--     SELECT 1
--       FROM roles r
--       JOIN role_permission_grants rpg ON rpg.role_id = r.id
--       JOIN permissions p ON p.id = rpg.permission_id
--      WHERE r.name = 'SYSTEM_ADMIN'
--        AND r.is_template = TRUE
--        AND r.branch_id IS NULL
--        AND p.key = missing.key
--        AND rpg.scope_type = 'GLOBAL'
--   )
-- ) AS missing_system_admin_global_grants;
