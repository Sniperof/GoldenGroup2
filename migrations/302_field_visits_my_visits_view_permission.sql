-- ============================================================
-- 302_field_visits_my_visits_view_permission.sql
-- ============================================================
-- Dedicated permission for the standalone "زياراتي" (my visits) page — the field
-- team member's own visits, i.e. visits whose assigned team includes them
-- (branch-scope-and-visibility-standard.md §6: visit management moved to a
-- single-branch admin page; the executor gets this personal surface instead).
--
-- Mirrors tasks.my_customers.view (migration 301): inherently personal, so the
-- key allows ONLY 'ASSIGNED'. It lives OUTSIDE the (now management) Visits page
-- and gates a single page that self-scopes by team membership (employee = holder).
--
-- Granting: assign this key (scope ASSIGNED) to the supervisor/technician role
-- via the roles UI. No data seeding — visibility is opt-in per role.
-- Idempotent (re-runnable).
-- ============================================================

BEGIN;

INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'field_visits.my_visits.view', 'field_visits', 'my_visits', 'view',
  'عرض صفحة «زياراتي» (زيارات فريقي)', 319, ARRAY['ASSIGNED']
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
