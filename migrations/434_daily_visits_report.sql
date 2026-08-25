BEGIN;

-- A daily visit report is an independent read/export surface. Its grants are
-- seeded from the role's existing canonical visit-list capabilities, while the
-- report permissions remain independently manageable after migration.
WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    (
      'reports.daily_work.visits_log.view',
      'reports',
      'daily_work',
      'view',
      'عرض تقرير سجل الزيارات اليومية',
      502,
      ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]
    ),
    (
      'reports.daily_work.visits_log.export',
      'reports',
      'daily_work',
      'export',
      'تصدير تقرير سجل الزيارات اليومية إلى Excel',
      503,
      ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]
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

WITH visit_role_scope AS (
  SELECT
    rpg.role_id,
    MAX(CASE rpg.scope_type WHEN 'GLOBAL' THEN 3 WHEN 'BRANCH' THEN 2 ELSE 1 END) AS scope_rank
  FROM public.role_permission_grants rpg
  JOIN public.permissions source_permission ON source_permission.id = rpg.permission_id
  WHERE source_permission.key IN ('field_visits.view','field_visits.my_visits.view')
  GROUP BY rpg.role_id
), report_grants AS (
  SELECT
    source.role_id,
    report_permission.id AS permission_id,
    CASE source.scope_rank WHEN 3 THEN 'GLOBAL' WHEN 2 THEN 'BRANCH' ELSE 'ASSIGNED' END AS scope_type
  FROM visit_role_scope source
  CROSS JOIN public.permissions report_permission
  WHERE report_permission.key IN (
    'reports.daily_work.visits_log.view',
    'reports.daily_work.visits_log.export'
  )
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT role_id, permission_id, scope_type
FROM report_grants
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  scope_type = CASE
    WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
    WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
    ELSE 'ASSIGNED'
  END,
  updated_at = NOW();

COMMIT;
