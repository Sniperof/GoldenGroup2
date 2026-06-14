-- ============================================================
-- 272_departments_manage_permission.sql
-- ============================================================
-- Introduce a dedicated department management permission so branch detail
-- workflows can separate department CRUD from employee CRUD.
-- ============================================================

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('departments.manage', 'departments', 'departments', 'manage',
   'إدارة الأقسام', 11, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
