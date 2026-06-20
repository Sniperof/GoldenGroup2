-- ============================================================
-- 301_tasks_my_customers_view_permission.sql
-- ============================================================
-- Dedicated permission for the standalone "مهامي" (my customers' tasks) page —
-- the ASSIGNED-scope aggregate showing every task of customers the holder
-- PERSONALLY OWNS (branch-scope-and-visibility-standard.md §7, مُسنَد path 1).
--
-- Why a new key (not reusing tasks.*.view): the per-table view keys from
-- migration 288 allow only {GLOBAL,BRANCH}, so a supervisor cannot be granted
-- them at ASSIGNED scope. This page is inherently personal, so its key allows
-- ONLY 'ASSIGNED'. It lives outside the "Operations & Tasks" section and gates
-- a single page that self-scopes by ownership (hr_user_id = the holder).
--
-- Granting: assign this key (scope ASSIGNED) to the supervisor/technician role
-- via the roles UI. No data seeding here — visibility is opt-in per role.
-- Idempotent (re-runnable).
-- ============================================================

BEGIN;

INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'tasks.my_customers.view', 'tasks', 'my_customers', 'view',
  'عرض صفحة «مهامي» (مهام زبائني المسندة)', 318, ARRAY['ASSIGNED']
)
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

COMMIT;
