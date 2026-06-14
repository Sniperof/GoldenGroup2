-- ============================================================
-- 278_zone_study_permissions.sql
-- ============================================================
-- DEC-008 (D43): Zone Study read/write permissions.
--
-- Per the permissions engineering standard, the read decision is separated from
-- the write decision; planning.manage is NOT reused.
--   planning.zone_study.view   — read the study table and snapshots (all GET)
--   planning.zone_study.manage — refresh snapshot + manual picks (POST/DELETE)
--
-- Scope model: BRANCH only (the branch manager sees/manages their whole branch).
-- ASSIGNED is not supported. Mode-2 per-user privacy is enforced by the
-- zone_study_snapshots.user_id column, not by scope.
-- ============================================================

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  (
    'planning.zone_study.view',
    'planning',
    'zone_study',
    'view',
    'عرض دراسة النطاقات',
    140,
    ARRAY['BRANCH']
  ),
  (
    'planning.zone_study.manage',
    'planning',
    'zone_study',
    'manage',
    'إدارة دراسة النطاقات',
    141,
    ARRAY['BRANCH']
  )
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

WITH permission_rows AS (
  SELECT id FROM public.permissions
   WHERE key IN ('planning.zone_study.view', 'planning.zone_study.manage')
),
role_grants AS (
  -- Case-insensitive match so the grant lands across environments whose role
  -- names vary in case (e.g. template 'BRANCH_MANAGER' vs a seeded 'branch_manager').
  SELECT r.id AS role_id, p.id AS permission_id, 'BRANCH'::varchar AS scope_type
    FROM public.roles r
    CROSS JOIN permission_rows p
   WHERE UPPER(r.name) IN ('BRANCH_MANAGER', 'DEV_BRANCH_USER')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT role_id, permission_id, scope_type FROM role_grants
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

COMMIT;
