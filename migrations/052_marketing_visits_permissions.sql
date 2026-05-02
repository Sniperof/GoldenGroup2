-- Marketing Visits MVP permissions
-- Adds explicit permissions for viewing and updating marketing visit results.

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('marketing_visits.view', 'marketing_visits', 'visits', 'view', 'عرض زيارات التسويق', 167),
  ('marketing_visits.update_result', 'marketing_visits', 'visits', 'update_result', 'تسجيل نتيجة زيارة التسويق', 168)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      sub_module = EXCLUDED.sub_module,
      action = EXCLUDED.action,
      display_name = EXCLUDED.display_name,
      display_order = EXCLUDED.display_order;

-- SYSTEM_ADMIN — GLOBAL
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p ON p.key IN ('marketing_visits.view', 'marketing_visits.update_result')
 WHERE UPPER(r.name) = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN ('marketing_visits.view', 'marketing_visits.update_result')
 WHERE UPPER(r.name) = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ADMIN — BRANCH
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key IN ('marketing_visits.view', 'marketing_visits.update_result')
 WHERE UPPER(r.name) = 'ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN ('marketing_visits.view', 'marketing_visits.update_result')
 WHERE UPPER(r.name) = 'ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- BRANCH_MANAGER — BRANCH
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key IN ('marketing_visits.view', 'marketing_visits.update_result')
 WHERE UPPER(r.name) = 'BRANCH_MANAGER'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN ('marketing_visits.view', 'marketing_visits.update_result')
 WHERE UPPER(r.name) = 'BRANCH_MANAGER'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;
