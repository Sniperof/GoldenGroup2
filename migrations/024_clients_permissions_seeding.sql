-- ============================================================
-- Migration 024: Clients permissions seeding
-- - Adds the canonical clients permission keys used by runtime
-- - Grants them conservatively to template roles with BRANCH scope
-- ============================================================

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('clients.view_list', 'clients', 'clients', 'view_list', 'عرض قائمة الزبائن', 10),
  ('clients.view', 'clients', 'clients', 'view', 'عرض الزبون', 20),
  ('clients.create', 'clients', 'clients', 'create', 'إنشاء زبون', 30),
  ('clients.edit', 'clients', 'clients', 'edit', 'تعديل زبون', 40),
  ('clients.delete', 'clients', 'clients', 'delete', 'حذف زبون', 50)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.key IN (
      'clients.view_list',
      'clients.view',
      'clients.create',
      'clients.edit',
      'clients.delete'
    )
 WHERE r.is_template = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p
    ON p.key IN (
      'clients.view_list',
      'clients.view',
      'clients.create',
      'clients.edit',
      'clients.delete'
    )
 WHERE r.is_template = TRUE
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();
