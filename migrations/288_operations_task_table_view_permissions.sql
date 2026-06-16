-- ============================================================
-- 288_operations_task_table_view_permissions.sql
-- ============================================================
-- Per-table VIEW permissions for the "Operations & Tasks" section so that a
-- role (e.g. a specific branch manager) can be granted some task tables and
-- denied others. Each key gates one filtered open_tasks view by task_type set;
-- editing stays on the unified open_tasks.edit (product decision 2026-06-15).
--
-- 8 new keys here; the device delivery/installation tables reuse the existing
-- tasks.delivery.view / tasks.installation.view. Scope model {GLOBAL,BRANCH}
-- matches migration 287 — GLOBAL = all branches, BRANCH = the actor's branches.
--
-- Seeding policy: mirror the current open_tasks.view grants onto every
-- table-view key so existing viewers keep seeing all tables by default; admins
-- then revoke specific tables per role. Idempotent (re-runnable).
-- ============================================================

BEGIN;

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('tasks.demo.view', 'tasks', 'demo', 'view',
      'عرض جدول مهام عرض الجهاز', 310, ARRAY['GLOBAL','BRANCH']),
    ('tasks.maintenance.view', 'tasks', 'maintenance', 'view',
      'عرض جدول مهام الصيانة', 311, ARRAY['GLOBAL','BRANCH']),
    ('tasks.collection.view', 'tasks', 'collection', 'view',
      'عرض جدول مهام تحصيل الأقساط', 312, ARRAY['GLOBAL','BRANCH']),
    ('tasks.after_sales.view', 'tasks', 'after_sales', 'view',
      'عرض جدول مهام خدمات ما بعد البيع', 313, ARRAY['GLOBAL','BRANCH']),
    ('tasks.gifts.view', 'tasks', 'gifts', 'view',
      'عرض جدول مهام تسليم الهدايا', 314, ARRAY['GLOBAL','BRANCH']),
    ('tasks.warranty.view', 'tasks', 'warranty', 'view',
      'عرض جدول مهام خدمات الكفالة', 315, ARRAY['GLOBAL','BRANCH']),
    ('tasks.activation.view', 'tasks', 'activation', 'view',
      'عرض جدول مهام تشغيل الجهاز', 316, ARRAY['GLOBAL','BRANCH']),
    ('tasks.supervisor_alerts.view', 'tasks', 'supervisor_alerts', 'view',
      'عرض صفحة تنبيهات المشرف', 317, ARRAY['GLOBAL','BRANCH'])
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

-- Seed: every table-view key inherits the current open_tasks.view grants
-- (same role, same scope). Covers the 8 new keys plus the device tables that
-- reuse tasks.delivery.view / tasks.installation.view.
WITH table_view_permissions AS (
  SELECT id FROM public.permissions
  WHERE key IN (
    'tasks.demo.view',
    'tasks.maintenance.view',
    'tasks.collection.view',
    'tasks.after_sales.view',
    'tasks.gifts.view',
    'tasks.warranty.view',
    'tasks.activation.view',
    'tasks.supervisor_alerts.view',
    'tasks.delivery.view',
    'tasks.installation.view'
  )
),
umbrella_grants AS (
  SELECT rpg.role_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'open_tasks.view'
    AND rpg.scope_type IN ('GLOBAL','BRANCH')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT ug.role_id, tvp.id, ug.scope_type
FROM umbrella_grants ug
CROSS JOIN table_view_permissions tvp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

COMMIT;
