-- ============================================================
-- 279_geo_units_permission_tree.sql
-- ============================================================
-- Separate routine address lookup from administrative-levels view/manage.
--
--   geo_units.lookup  (NEW)  GLOBAL/BRANCH/ASSIGNED  — read active units as
--                            address-field options, filtered by branch coverage.
--   geo.view          (kept) GLOBAL/BRANCH           — open the levels admin
--                            page and read units (incl. inactive) within scope.
--   geo.manage        (kept) GLOBAL ONLY             — create/edit/delete/status
--                            of administrative levels. National tree is HQ-only;
--                            no branch may mutate it.
--
-- Backfill: every role that currently holds geo.view also receives
-- geo_units.lookup at the same scope, so existing address forms keep working
-- after the code stops accepting geo.view for routine lookups.
--
-- Idempotent / safe to re-run.
-- ============================================================

BEGIN;

-- 1) Define / upsert the new dedicated lookup permission.
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'geo_units.lookup', 'geo', 'geo_units', 'lookup',
  'قراءة المناطق داخل الحقول', 182, ARRAY['GLOBAL','BRANCH','ASSIGNED']
)
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

-- 2) Restrict administrative management to GLOBAL only (requirement: adding any
--    value within any administrative level is HQ/GLOBAL-only).
UPDATE public.permissions
SET allowed_scopes = ARRAY['GLOBAL']
WHERE key = 'geo.manage';

-- 3) Keep geo.view as the admin-view surface (GLOBAL/BRANCH), branch-filtered.
UPDATE public.permissions
SET allowed_scopes = ARRAY['GLOBAL','BRANCH']
WHERE key = 'geo.view';

-- 4) Remove now-invalid grants: any non-GLOBAL grant of geo.manage. These were
--    permitted by the old {GLOBAL,BRANCH} scope and would let a branch edit the
--    national tree. They become unrepresentable, so drop them.
DELETE FROM public.role_permission_grants rpg
USING public.permissions p
WHERE rpg.permission_id = p.id
  AND p.key = 'geo.manage'
  AND rpg.scope_type <> 'GLOBAL';

-- 5) Backfill geo_units.lookup from existing geo.view grants (same scope) so no
--    role loses the ability to fill address fields.
WITH lookup_perm AS (
  SELECT id FROM public.permissions WHERE key = 'geo_units.lookup'
),
view_grants AS (
  SELECT rpg.role_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'geo.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT view_grants.role_id, lookup_perm.id, view_grants.scope_type
FROM view_grants
CROSS JOIN lookup_perm
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

COMMIT;
