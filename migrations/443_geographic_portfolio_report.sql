BEGIN;

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    (
      'reports.performance.geographic_portfolio.view',
      'reports',
      'performance',
      'view',
      'عرض تقرير التوزيع الجغرافي للزبائن والأجهزة',
      506,
      ARRAY['GLOBAL','BRANCH']::text[]
    ),
    (
      'reports.performance.geographic_portfolio.export',
      'reports',
      'performance',
      'export',
      'تصدير تقرير التوزيع الجغرافي للزبائن والأجهزة إلى Excel',
      507,
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

-- Initial access is the least broad common scope of the three underlying
-- management capabilities. The report remains an independent capability after
-- this one-time baseline and is managed normally through role_permission_grants.
WITH required_grants AS (
  SELECT grant_row.role_id,
         permission.key,
         grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key IN ('clients.view_list', 'installed_devices.view', 'field_visits.view')
     AND grant_row.scope_type IN ('GLOBAL', 'BRANCH')
), eligible_roles AS (
  SELECT role_id,
         CASE WHEN BOOL_AND(scope_type = 'GLOBAL') THEN 'GLOBAL' ELSE 'BRANCH' END AS scope_type
    FROM required_grants
   GROUP BY role_id
  HAVING COUNT(DISTINCT key) = 3
), report_grants AS (
  SELECT eligible.role_id, report_permission.id AS permission_id, eligible.scope_type
    FROM eligible_roles eligible
    CROSS JOIN public.permissions report_permission
   WHERE report_permission.key IN (
     'reports.performance.geographic_portfolio.view',
     'reports.performance.geographic_portfolio.export'
   )
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT role_id, permission_id, scope_type
FROM report_grants
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  scope_type = EXCLUDED.scope_type,
  updated_at = NOW();

COMMIT;
