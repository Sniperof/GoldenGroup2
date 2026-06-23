-- ============================================================
-- 321_field_visits_create_instant_permission.sql
-- ============================================================
-- DEC-011: dedicated permission for creating a field-initiated instant visit
-- from the «زياراتي» (my-visits) surface. Inherently personal — the team
-- responsible acts on their own team today — so the key allows ONLY 'ASSIGNED'
-- (mirrors field_visits.my_visits.view, migration 302).
--
-- Granting: assign this key (scope ASSIGNED) to the supervisor/technician role
-- via the roles UI. No data seeding — visibility is opt-in per role.
-- Idempotent (re-runnable).
-- ============================================================

BEGIN;

INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'field_visits.create_instant', 'field_visits', 'create_instant', 'create',
  'إنشاء زيارة فورية ميدانية (DEC-011)', 320, ARRAY['ASSIGNED']
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
