BEGIN;

-- Independent report capabilities. The report grain is the installed device and
-- intentionally supports GLOBAL/BRANCH only; there is no assigned-user subject.
WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    (
      'reports.service.installed_devices.view',
      'reports',
      'service',
      'view',
      'عرض تقرير ملف الأجهزة وخدمة الزبائن',
      504,
      ARRAY['GLOBAL','BRANCH']::text[]
    ),
    (
      'reports.service.installed_devices.export',
      'reports',
      'service',
      'export',
      'تصدير تقرير ملف الأجهزة وخدمة الزبائن إلى Excel',
      505,
      ARRAY['GLOBAL','BRANCH']::text[]
    )
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

-- Preserve the existing device visibility boundary as the initial baseline.
-- ASSIGNED grants are deliberately excluded because this report has no assigned subject.
WITH source_grants AS (
  SELECT grants.role_id, grants.scope_type
  FROM public.role_permission_grants grants
  JOIN public.permissions permission ON permission.id = grants.permission_id
  WHERE permission.key = 'installed_devices.view'
    AND grants.scope_type IN ('GLOBAL', 'BRANCH')
), report_grants AS (
  SELECT source.role_id, report_permission.id AS permission_id, source.scope_type
  FROM source_grants source
  CROSS JOIN public.permissions report_permission
  WHERE report_permission.key IN (
    'reports.service.installed_devices.view',
    'reports.service.installed_devices.export'
  )
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT role_id, permission_id, scope_type
FROM report_grants
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  scope_type = EXCLUDED.scope_type,
  updated_at = NOW();

COMMIT;
