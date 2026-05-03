-- Add planning.view and planning.manage permissions that were missing from the DB.
-- planning.schedule.appear (id=40, display_order=153) already exists.

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('planning.view',   'planning', 'general', 'view',   'عرض خطط وجداول الفرع',           151, ARRAY['GLOBAL','BRANCH']),
  ('planning.manage', 'planning', 'general', 'manage', 'إدارة الجدولة وتعيين المسارات',   152, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE
  SET module        = EXCLUDED.module,
      sub_module    = EXCLUDED.sub_module,
      action        = EXCLUDED.action,
      display_name  = EXCLUDED.display_name,
      display_order = EXCLUDED.display_order,
      allowed_scopes = EXCLUDED.allowed_scopes;

-- Grant both to SYSTEM_ADMIN template role
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p ON p.key IN ('planning.view', 'planning.manage')
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN ('planning.view', 'planning.manage')
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;
