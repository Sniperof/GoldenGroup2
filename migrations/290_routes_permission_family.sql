-- ============================================================
-- 290_routes_permission_family.sql
-- ============================================================
-- Dedicated permission family for travel routes (خطوط السير), split off from
-- the national geographic tree (geo.*).
--
-- Why: routes are a BRANCH-operational entity — each branch builds its own
-- ordered travel routes inside its coverage. They were guarded by `geo.manage`,
-- but migration 279 reserved `geo.manage` for the HQ-only national levels tree
-- (GLOBAL only) and DELETED every branch grant of it. That silently removed any
-- branch manager's ability to manage their branch routes, and left GLOBAL
-- holders editing routes with no geographic isolation. One key was guarding two
-- security-distinct concerns — forbidden by the engineering standard §4.1.
--
--   routes.view    (NEW)  GLOBAL/BRANCH  — list/read routes (geo-scoped read)
--   routes.manage  (NEW)  GLOBAL/BRANCH  — create/edit/delete routes inside
--                                          branch coverage (geo containment is
--                                          still enforced by geoScopeService).
--
-- Backfill (conservative, grant-driven — never widen write access):
--   routes.view   <- geo.view   (same scope)         — restore read for all.
--   routes.manage <- geo.manage (GLOBAL only now)    — HQ keeps manage.
--
-- Branch-manager `routes.manage` at BRANCH scope is intentionally NOT
-- auto-granted here: migration 279 destroyed the original branch geo.manage
-- grants, and `geo.view` grants cannot distinguish a branch manager (should get
-- manage) from a supervisor (read only). Auto-deriving manage from a view grant
-- would over-provision write access to supervisors. The branch-manager baseline
-- (routes.manage = BRANCH) is therefore applied via the roles UI on each
-- environment, consistent with the 2026-06-13 baseline-seed precedent.
--
-- Idempotent / safe to re-run.
-- ============================================================

BEGIN;

-- 1) Define / upsert the new dedicated route permissions.
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('routes.view',   'routes', 'routes', 'view',   'عرض خطوط السير',   190, ARRAY['GLOBAL','BRANCH']),
  ('routes.manage', 'routes', 'routes', 'manage', 'إدارة خطوط السير', 191, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

-- 2) Backfill routes.view from existing geo.view grants (same scope) so every
--    role that could read the geographic surface keeps route read access.
WITH view_perm AS (
  SELECT id FROM public.permissions WHERE key = 'routes.view'
),
geo_view_grants AS (
  SELECT rpg.role_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'geo.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT geo_view_grants.role_id, view_perm.id, geo_view_grants.scope_type
FROM geo_view_grants
CROSS JOIN view_perm
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

-- 3) Backfill routes.manage from existing geo.manage grants (GLOBAL only after
--    migration 279) so HQ keeps route management. Branch manage is seeded via
--    the roles UI (see header) — deliberately not derived from view grants.
WITH manage_perm AS (
  SELECT id FROM public.permissions WHERE key = 'routes.manage'
),
geo_manage_grants AS (
  SELECT rpg.role_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'geo.manage'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT geo_manage_grants.role_id, manage_perm.id, geo_manage_grants.scope_type
FROM geo_manage_grants
CROSS JOIN manage_perm
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

COMMIT;
