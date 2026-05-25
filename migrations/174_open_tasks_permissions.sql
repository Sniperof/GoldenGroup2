-- 174_open_tasks_permissions.sql
-- Replaces marketing_visits.view / marketing_visits.update_result usage in openTasks.ts
-- with domain-specific open_tasks.view / open_tasks.edit permissions.
-- The old marketing_visits.* permissions are kept intact (still used by
-- fieldVisits.ts, workScopes.ts, emergencyResult.ts until those domains are audited).
BEGIN;

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('open_tasks.view', 'open_tasks', 'tasks', 'view', 'عرض المهام المفتوحة',   200, ARRAY['GLOBAL', 'BRANCH']),
  ('open_tasks.edit', 'open_tasks', 'tasks', 'edit', 'تعديل المهام المفتوحة', 201, ARRAY['GLOBAL', 'BRANCH'])
ON CONFLICT (key) DO NOTHING;

-- Grant open_tasks.view to every role that currently has marketing_visits.view,
-- preserving the same scope_type (GLOBAL for SYSTEM_ADMIN, BRANCH for others).
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT rpg.role_id, new_p.id, rpg.scope_type
FROM role_permission_grants rpg
JOIN permissions old_p ON old_p.id = rpg.permission_id AND old_p.key = 'marketing_visits.view'
JOIN permissions new_p ON new_p.key = 'open_tasks.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant open_tasks.edit to every role that currently has marketing_visits.update_result.
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT rpg.role_id, new_p.id, rpg.scope_type
FROM role_permission_grants rpg
JOIN permissions old_p ON old_p.id = rpg.permission_id AND old_p.key = 'marketing_visits.update_result'
JOIN permissions new_p ON new_p.key = 'open_tasks.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
