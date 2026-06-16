-- ============================================================
-- 289_tasks_unified_result_permission_and_legacy_cleanup.sql
-- ============================================================
-- Operations & Tasks permission tidy-up (product decision 2026-06-15):
--   1. Add a single explicit "record task result" permission, used for every
--      task type regardless of its name (results already flow through one
--      mechanism: visit_task_results / visitTaskResultReflection).
--   2. Retire the legacy per-type create/result keys that no route ever checked
--      (defined-but-unenforced, P3). They conflated the wrong axes: results are
--      unified (not per-type) and creation is event-driven (not a user action).
--
-- tasks.results.record is seeded from the current field_visits.edit grants so
-- everyone who can record a visit result today keeps that ability.
-- Idempotent (re-runnable).
-- ============================================================

BEGIN;

-- 1. Unified result-recording permission.
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'tasks.results.record', 'tasks', 'results', 'record',
  'تسجيل نتائج المهام', 320, ARRAY['GLOBAL','BRANCH']
)
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

-- Seed: mirror current field_visits.edit grants (whoever records results today).
WITH result_permission AS (
  SELECT id FROM public.permissions WHERE key = 'tasks.results.record'
),
source_grants AS (
  SELECT rpg.role_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'field_visits.edit'
    AND rpg.scope_type IN ('GLOBAL','BRANCH')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, rp.id, sg.scope_type
FROM source_grants sg
CROSS JOIN result_permission rp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

-- 2. Retire the 5 legacy, never-enforced per-type create/result keys.
WITH legacy_keys(key) AS (
  VALUES
    ('tasks.delivery.create'),
    ('tasks.delivery.result'),
    ('tasks.installation.create'),
    ('tasks.installation.result'),
    ('tasks.activation.create')
)
DELETE FROM public.role_permission_grants rpg
USING public.permissions p, legacy_keys lk
WHERE rpg.permission_id = p.id AND p.key = lk.key;

WITH legacy_keys(key) AS (
  VALUES
    ('tasks.delivery.create'),
    ('tasks.delivery.result'),
    ('tasks.installation.create'),
    ('tasks.installation.result'),
    ('tasks.activation.create')
)
DELETE FROM public.permissions p
USING legacy_keys lk
WHERE p.key = lk.key;

COMMIT;
