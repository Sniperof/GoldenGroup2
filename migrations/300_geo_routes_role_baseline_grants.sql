-- ============================================================
-- 300_geo_routes_role_baseline_grants.sql
-- ============================================================
-- Geographic admin levels + routes (خطوط السير) role baseline for the three
-- management roles, decided 2026-06-17.
--
-- Capability framing (behaviour follows the GRANTED SCOPE, not identity — a role
-- is a bundle that any number of users may hold):
--
--   geo.view              عرض المستويات الإدارية الجغرافية   {GLOBAL,BRANCH}
--   geo.manage            تعديل الشجرة الجغرافية (مركزي)      {GLOBAL}
--   routes.view           عرض خطوط السير                      {GLOBAL,BRANCH}
--   routes.manage         تعريف/تعديل خطوط السير              {GLOBAL,BRANCH}
--   routes.assign.view    عرض توزيع المسارات                   {GLOBAL,BRANCH}
--   routes.assign.manage  توزيع المسارات على الفرق            {GLOBAL,BRANCH}
--
-- Decisions:
--   - company_manager → ALL six at GLOBAL (top management capability across every
--     branch, incl. central geo-tree editing).
--   - branch_manager  → full BRANCH set EXCEPT geo.manage (restructuring the
--     national geographic tree is a central act, kept off the branch tier).
--   - supervisor      → VIEW-ONLY at BRANCH (geo.view, routes.view,
--     routes.assign.view). No defining routes, no distributing them — that is the
--     branch manager and above. (Existing geo_units.lookup is unchanged.)
--
-- Idempotent; joins by role NAME and permission KEY. ON CONFLICT DO UPDATE so the
-- scope is corrected on re-run.
-- ============================================================

BEGIN;

-- company_manager → GLOBAL on the full geo + routes capability set.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'company_manager'
  AND p.key IN (
    'geo.view', 'geo.manage',
    'routes.view', 'routes.manage',
    'routes.assign.view', 'routes.assign.manage'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

-- branch_manager → BRANCH on everything except geo.manage.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'branch_manager'
  AND p.key IN (
    'geo.view',
    'routes.view', 'routes.manage',
    'routes.assign.view', 'routes.assign.manage'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

-- supervisor (role name 'supervisior') → VIEW-ONLY at BRANCH.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'supervisior'
  AND p.key IN (
    'geo.view',
    'routes.view',
    'routes.assign.view'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

COMMIT;
