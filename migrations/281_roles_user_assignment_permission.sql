-- ============================================================
-- 281_roles_user_assignment_permission.sql
-- ============================================================
-- Split user/system-account role assignment from role permission
-- tree management. Branch and company managers may assign users
-- to existing role templates without being allowed to edit grants.
-- ============================================================

BEGIN;

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('admin.roles.users.manage', 'admin', 'roles_users', 'manage',
      'إسناد الأدوار للمستخدمين', 44, ARRAY['GLOBAL','BRANCH'])
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

WITH target_permission AS (
  SELECT id
  FROM public.permissions
  WHERE key = 'admin.roles.users.manage'
),
role_grants AS (
  SELECT r.id AS role_id, tp.id AS permission_id, 'GLOBAL'::varchar AS scope_type
  FROM public.roles r
  CROSS JOIN target_permission tp
  WHERE UPPER(r.name) IN ('SYSTEM_ADMIN', 'ADMIN', 'SUPER_ADMIN', 'COMPANY_MANAGER', 'MANAGER')

  UNION ALL

  SELECT r.id AS role_id, tp.id AS permission_id, 'BRANCH'::varchar AS scope_type
  FROM public.roles r
  CROSS JOIN target_permission tp
  WHERE UPPER(r.name) IN ('BRANCH_MANAGER', 'DEV_BRANCH_USER')

  UNION ALL

  SELECT DISTINCT rpg.role_id, tp.id AS permission_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  CROSS JOIN target_permission tp
  WHERE p.key IN ('admin.roles.manage', 'users.branch_assignments.manage')
    AND rpg.scope_type IN ('GLOBAL','BRANCH')
),
deduped_role_grants AS (
  SELECT
    role_id,
    permission_id,
    CASE
      WHEN BOOL_OR(scope_type = 'GLOBAL') THEN 'GLOBAL'
      ELSE 'BRANCH'
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
  ELSE 'BRANCH'
END;

COMMIT;
