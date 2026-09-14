BEGIN;

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.work_files.names_file.view', 'reports', 'work_files', 'view', 'ملف الأسماء', 512, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]),
    ('reports.work_files.names_file.export', 'reports', 'work_files', 'export', 'ملف الأسماء', 513, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[])
)
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
SELECT key, module, sub_module, action, display_name, display_order, allowed_scopes
FROM source_permissions
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

-- One-time conservative baseline: roles already allowed to view candidate
-- records receive the report at no broader scope. Export stays independent
-- and is deliberately not auto-granted.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'candidates.view_list'
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.work_files.names_file.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
