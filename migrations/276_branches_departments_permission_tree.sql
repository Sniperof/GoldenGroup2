-- ============================================================
-- 276_branches_departments_permission_tree.sql
-- ============================================================
-- Split branch/department navigation and lookup from management actions.
-- The section remains branch-scoped for branch managers, while lookup grants
-- allow form dropdowns without exposing admin management.
-- ============================================================

BEGIN;

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('branches.nav', 'branches', 'navigation', 'nav',
      'إظهار إدارة الفروع والأقسام', 180, ARRAY['GLOBAL','BRANCH']),
    ('branches.lookup', 'branches', 'management', 'lookup',
      'قراءة الفروع داخل الحقول', 181, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
    ('branches.view', 'branches', 'management', 'view',
      'عرض الفروع', 182, ARRAY['GLOBAL','BRANCH']),
    ('branches.edit', 'branches', 'management', 'edit',
      'تعديل بيانات الفرع', 183, ARRAY['GLOBAL','BRANCH']),
    ('branches.manage', 'branches', 'management', 'manage',
      'إدارة الفروع', 184, ARRAY['GLOBAL','BRANCH']),
    ('departments.lookup', 'branches', 'departments', 'lookup',
      'قراءة الأقسام داخل الحقول', 185, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
    ('departments.view_list', 'branches', 'departments', 'view_list',
      'عرض أقسام الفروع', 186, ARRAY['GLOBAL','BRANCH']),
    ('departments.manage', 'branches', 'departments', 'manage',
      'إدارة الأقسام', 187, ARRAY['GLOBAL','BRANCH'])
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

WITH target_permissions AS (
  SELECT id, key
  FROM public.permissions
  WHERE key IN ('branches.nav', 'branches.lookup', 'departments.lookup')
),
role_source AS (
  SELECT
    rpg.role_id,
    tp.key AS target_key,
    CASE
      WHEN BOOL_OR(rpg.scope_type = 'GLOBAL') THEN 'GLOBAL'
      WHEN BOOL_OR(rpg.scope_type = 'BRANCH') THEN 'BRANCH'
      ELSE 'ASSIGNED'
    END::varchar AS scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  JOIN target_permissions tp ON (
    (tp.key = 'branches.nav' AND p.key IN ('branches.view', 'branches.edit', 'branches.manage'))
    OR (tp.key = 'branches.lookup' AND p.key IN ('branches.view', 'branches.edit', 'branches.manage', 'reference_data.lookup'))
    OR (tp.key = 'departments.lookup' AND p.key IN ('departments.view_list', 'departments.manage', 'reference_data.lookup'))
  )
  GROUP BY rpg.role_id, tp.key
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT role_source.role_id, target_permissions.id, role_source.scope_type
FROM role_source
JOIN target_permissions ON target_permissions.key = role_source.target_key
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

COMMIT;
