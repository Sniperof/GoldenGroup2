-- ============================================================
-- 291_route_assignments_permission_family.sql
-- ============================================================
-- Dedicated permission family for route ASSIGNMENTS (توزيع المسارات) — the
-- daily binding of a team to its routes/zones (route_assignments table).
--
-- Why: `routeAssignments.ts` had NO permission check at all (only requireAuth),
-- so any authenticated user could read every branch's daily plan and overwrite
-- any team's assignment via the guessable `YYYY-MM-DD_team_N` key (standard
-- §3-3 / §3-7). The routes constitution claimed `marketing_visits.*` guarded it,
-- but the code never enforced them. This split gives assignments their own keys,
-- distinct from route DEFINITION (`routes.*`, migration 290).
--
--   routes.assign.view    (NEW)  GLOBAL/BRANCH  — read team route assignments
--   routes.assign.manage  (NEW)  GLOBAL/BRANCH  — create/update an assignment
--
-- The owning branch of an assignment is derived from the scheduled team's
-- employees (day_schedules has no branch_id — GAP-DS-005), so BRANCH-scoped
-- callers are confined to assignments whose team belongs to their branch.
--
-- Backfill (conservative): map the previously-claimed marketing_visits keys to
-- the new ones at the same scope. The planner / branch-manager baseline grant is
-- applied via the roles UI (same precedent as routes.* in migration 290).
--
--   routes.assign.view   <- marketing_visits.view          (same scope)
--   routes.assign.manage <- marketing_visits.update_result (same scope)
--
-- Idempotent / safe to re-run.
-- ============================================================

BEGIN;

-- 1) Define / upsert the new dedicated assignment permissions.
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('routes.assign.view',   'routes', 'assignments', 'view',   'عرض توزيع المسارات',   192, ARRAY['GLOBAL','BRANCH']),
  ('routes.assign.manage', 'routes', 'assignments', 'manage', 'إدارة توزيع المسارات', 193, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

-- 2) Backfill routes.assign.view from marketing_visits.view (same scope).
WITH view_perm AS (
  SELECT id FROM public.permissions WHERE key = 'routes.assign.view'
),
src_grants AS (
  SELECT rpg.role_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'marketing_visits.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT src_grants.role_id, view_perm.id, src_grants.scope_type
FROM src_grants
CROSS JOIN view_perm
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

-- 3) Backfill routes.assign.manage from marketing_visits.update_result (same scope).
WITH manage_perm AS (
  SELECT id FROM public.permissions WHERE key = 'routes.assign.manage'
),
src_grants AS (
  SELECT rpg.role_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'marketing_visits.update_result'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT src_grants.role_id, manage_perm.id, src_grants.scope_type
FROM src_grants
CROSS JOIN manage_perm
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

COMMIT;
