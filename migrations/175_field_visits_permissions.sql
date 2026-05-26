-- Migration 175: Add field_visits.view and field_visits.edit permissions
-- Replaces legacy marketing_visits.* permissions in fieldVisits.ts (GAP-027)

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('field_visits.view', 'field_visits', 'visits', 'view', 'عرض الزيارات الميدانية',   210, ARRAY['GLOBAL', 'BRANCH']),
  ('field_visits.edit', 'field_visits', 'visits', 'edit', 'تعديل الزيارات الميدانية', 211, ARRAY['GLOBAL', 'BRANCH'])
ON CONFLICT (key) DO NOTHING;

-- Grant field_visits.view to every role that currently has marketing_visits.view
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT rpg.role_id, new_p.id, rpg.scope_type
FROM role_permission_grants rpg
JOIN permissions old_p ON old_p.id = rpg.permission_id AND old_p.key = 'marketing_visits.view'
JOIN permissions new_p ON new_p.key = 'field_visits.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant field_visits.edit to every role that currently has marketing_visits.update_result
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT rpg.role_id, new_p.id, rpg.scope_type
FROM role_permission_grants rpg
JOIN permissions old_p ON old_p.id = rpg.permission_id AND old_p.key = 'marketing_visits.update_result'
JOIN permissions new_p ON new_p.key = 'field_visits.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;
