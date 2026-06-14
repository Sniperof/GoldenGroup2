-- ============================================================
-- 280_employees_permission_tree.sql
-- ============================================================
-- Resolve P1 from the permission audit: employee permissions are used by API
-- and UI but were missing from the permission catalog.
--
-- The tree separates employee administration from routine employee lookups
-- used by forms such as direct-manager and referrer fields.
-- ============================================================

BEGIN;

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('employees.nav', 'employees', 'navigation', 'nav',
      'إظهار سجلات الموظفين', 90, ARRAY['GLOBAL','BRANCH']),
    ('employees.lookup', 'employees', 'lookups', 'lookup',
      'قراءة الموظفين داخل الحقول', 91, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
    ('employees.manager_lookup', 'employees', 'lookups', 'manager_lookup',
      'قراءة المديرين المباشرين داخل الحقول', 92, ARRAY['GLOBAL','BRANCH']),
    ('employees.view_list', 'employees', 'records', 'view_list',
      'عرض قائمة الموظفين', 93, ARRAY['GLOBAL','BRANCH']),
    ('employees.create', 'employees', 'records', 'create',
      'إضافة موظف جديد', 94, ARRAY['GLOBAL','BRANCH']),
    ('employees.edit', 'employees', 'records', 'edit',
      'تعديل بيانات الموظف', 95, ARRAY['GLOBAL','BRANCH']),
    ('employees.delete', 'employees', 'records', 'delete',
      'حذف موظف', 96, ARRAY['GLOBAL','BRANCH'])
)
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
SELECT key, module, sub_module, action, display_name, display_order, allowed_scopes
FROM source_permissions
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

WITH permission_rows AS (
  SELECT id, key
  FROM public.permissions
  WHERE key IN (
    'employees.nav',
    'employees.lookup',
    'employees.manager_lookup',
    'employees.view_list',
    'employees.create',
    'employees.edit',
    'employees.delete'
  )
),
role_grants AS (
  SELECT r.id AS role_id, p.id AS permission_id, 'GLOBAL'::varchar AS scope_type
  FROM public.roles r
  CROSS JOIN permission_rows p
  WHERE UPPER(r.name) IN ('SYSTEM_ADMIN', 'ADMIN', 'SUPER_ADMIN')

  UNION ALL

  SELECT r.id AS role_id, p.id AS permission_id, 'GLOBAL'::varchar AS scope_type
  FROM public.roles r
  JOIN permission_rows p ON p.key IN ('employees.nav', 'employees.lookup', 'employees.manager_lookup', 'employees.view_list')
  WHERE UPPER(r.name) IN ('COMPANY_MANAGER', 'MANAGER')

  UNION ALL

  SELECT r.id AS role_id, p.id AS permission_id, 'BRANCH'::varchar AS scope_type
  FROM public.roles r
  CROSS JOIN permission_rows p
  WHERE UPPER(r.name) IN ('BRANCH_MANAGER', 'DEV_BRANCH_USER')

  UNION ALL

  SELECT DISTINCT rpg.role_id, p_target.id AS permission_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p_source ON p_source.id = rpg.permission_id
  JOIN permission_rows p_target ON p_target.key IN ('employees.nav', 'employees.lookup', 'employees.view_list')
  WHERE p_source.key IN ('branches.view', 'branches.manage')
    AND rpg.scope_type IN ('GLOBAL','BRANCH')

  UNION ALL

  SELECT DISTINCT rpg.role_id, p_target.id AS permission_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p_source ON p_source.id = rpg.permission_id
  JOIN permission_rows p_target ON p_target.key IN ('employees.lookup', 'employees.manager_lookup')
  WHERE p_source.key IN ('employees.create', 'employees.edit')
    AND rpg.scope_type IN ('GLOBAL','BRANCH')
),
deduped_role_grants AS (
  SELECT
    role_id,
    permission_id,
    CASE
      WHEN BOOL_OR(scope_type = 'GLOBAL') THEN 'GLOBAL'
      WHEN BOOL_OR(scope_type = 'BRANCH') THEN 'BRANCH'
      ELSE 'ASSIGNED'
    END::varchar AS scope_type
  FROM role_grants
  GROUP BY role_id, permission_id
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT role_id, permission_id, scope_type
FROM deduped_role_grants
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

WITH employee_write_roles AS (
  SELECT
    rpg.role_id,
    CASE
      WHEN BOOL_OR(rpg.scope_type = 'GLOBAL') THEN 'GLOBAL'
      WHEN BOOL_OR(rpg.scope_type = 'BRANCH') THEN 'BRANCH'
      ELSE 'ASSIGNED'
    END::varchar AS scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key IN ('employees.create', 'employees.edit')
    AND rpg.scope_type IN ('GLOBAL','BRANCH')
  GROUP BY rpg.role_id
),
support_permissions AS (
  SELECT id, key
  FROM public.permissions
  WHERE key IN ('branches.lookup', 'departments.lookup', 'geo_units.lookup', 'reference_data.lookup')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT ewr.role_id, sp.id, ewr.scope_type
FROM employee_write_roles ewr
CROSS JOIN support_permissions sp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

COMMIT;
