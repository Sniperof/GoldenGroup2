-- Permission controlling whether an employee appears in the available staff
-- pool inside team scheduling. The permission is evaluated on the employee's
-- assigned system-account role, not on the user opening the scheduling page.

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES (
  'planning.schedule.appear',
  'planning',
  'schedule',
  'appear',
  'الظهور في جدولة الفرق',
  153
)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      sub_module = EXCLUDED.sub_module,
      action = EXCLUDED.action,
      display_name = EXCLUDED.display_name,
      display_order = EXCLUDED.display_order;

-- Keep SYSTEM_ADMIN complete. Operational roles can be granted this
-- permission explicitly from the role permissions screen.
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p ON p.key = 'planning.schedule.appear'
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key = 'planning.schedule.appear'
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;
