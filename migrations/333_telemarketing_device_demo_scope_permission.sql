-- ============================================================
-- 333_telemarketing_device_demo_scope_permission.sql
-- ============================================================
-- Task-type-scoped view of the telemarketing contact queue.
--
-- A role may hold either:
--   * telemarketing.lists.view             → every contact (existing behaviour), OR
--   * telemarketing.lists.view_device_demo → only contacts that have at least one
--                                            'device_demo' (عرض جهاز) task. The
--                                            contact is shown with ALL its tasks
--                                            (grain أ), not just the device_demo one.
--
-- No automatic grant: this is a deliberately restrictive scope assigned to a role
-- INSTEAD of the broad view, from the role-permissions admin screen.
-- ============================================================

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('telemarketing.lists.view_device_demo', 'telemarketing', 'lists', 'view_device_demo',
   'عرض جهات الاتصال — مهام عرض الجهاز فقط', 162, ARRAY['GLOBAL','BRANCH','ASSIGNED'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
