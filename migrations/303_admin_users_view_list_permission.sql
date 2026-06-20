-- ============================================================
-- 303_admin_users_view_list_permission.sql
-- ============================================================
-- Dedicated VIEW permission for the new standalone Users page (split out of the
-- combined Roles & Users admin page). Separates "who may SEE the users list"
-- (scope-driven: GLOBAL = all users, BRANCH = own branch's users — treated like
-- the clients/employees record sections) from "who may MANAGE users" (the existing
-- admin.roles.users.manage). The Roles page stays GLOBAL-only (admin.roles.*).
--
-- Scope model {GLOBAL,BRANCH} mirrors the operational view_list keys.
--
-- Seeding: every role that already holds admin.roles.users.manage inherits
-- view_list at the SAME scope, so no current user-manager loses visibility.
-- Idempotent (re-runnable).
-- ============================================================

BEGIN;

INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'admin.users.view_list', 'admin', 'users', 'view_list',
  'عرض قائمة المستخدمين', 45, ARRAY['GLOBAL','BRANCH']
)
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

-- Inherit visibility from the existing manage grant (same scope).
WITH view_perm AS (
  SELECT id FROM public.permissions WHERE key = 'admin.users.view_list'
),
manage_grants AS (
  SELECT rpg.role_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'admin.roles.users.manage'
    AND rpg.scope_type IN ('GLOBAL','BRANCH')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT mg.role_id, vp.id, mg.scope_type
FROM manage_grants mg
CROSS JOIN view_perm vp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  ELSE 'BRANCH'
END;

COMMIT;
