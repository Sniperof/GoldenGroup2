-- ============================================================
-- Migration 028: User branch assignment management permissions
-- - Adds permissions required for admin management of
--   user_branch_assignments.
-- - Grants them conservatively to administrative template roles
--   with GLOBAL scope.
-- - Idempotent: safe to run multiple times.
-- ============================================================

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('users.branch_assignments.view', 'users', 'branch_assignments', 'view', 'عرض فروع المستخدمين المسموحة', 10),
  ('users.branch_assignments.manage', 'users', 'branch_assignments', 'manage', 'إدارة فروع المستخدمين المسموحة', 20)
ON CONFLICT (key) DO NOTHING;

-- Keep the legacy role_permissions table in sync for compatibility.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.key IN (
      'users.branch_assignments.view',
      'users.branch_assignments.manage'
    )
 WHERE r.is_template = TRUE
   AND r.name IN ('ADMIN', 'DEV_GLOBAL_ADMIN')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p
    ON p.key IN (
      'users.branch_assignments.view',
      'users.branch_assignments.manage'
    )
 WHERE r.is_template = TRUE
   AND r.name IN ('ADMIN', 'DEV_GLOBAL_ADMIN')
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();
