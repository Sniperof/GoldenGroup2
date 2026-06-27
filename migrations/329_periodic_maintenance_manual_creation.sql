-- ============================================================
-- 329_periodic_maintenance_manual_creation.sql
-- ============================================================
-- Phase 4 — Manual creation support for periodic maintenance.
-- ============================================================

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('tasks.periodic.create_manual', 'tasks', 'periodic_maintenance', 'create_manual',
   'إنشاء صيانة دورية يدوياً', 236, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

WITH source_grants AS (
  SELECT rpg.role_id,
         CASE
           WHEN rpg.scope_type = 'GLOBAL' THEN 'GLOBAL'
           ELSE 'BRANCH'
         END AS scope_type
    FROM public.role_permission_grants rpg
    JOIN public.permissions p ON p.id = rpg.permission_id
   WHERE p.key = 'tasks.create'
),
target_permission AS (
  SELECT id AS permission_id
    FROM public.permissions
   WHERE key = 'tasks.periodic.create_manual'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.permission_id, sg.scope_type
FROM source_grants sg
CROSS JOIN target_permission tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  ELSE 'BRANCH'
END,
updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.open_task_periodic_payload (
  open_task_id           INTEGER PRIMARY KEY REFERENCES public.open_tasks(id) ON DELETE CASCADE,
  generation_origin      VARCHAR(30) NOT NULL DEFAULT 'system',
  interval_days_snapshot INTEGER,
  manual_reason          VARCHAR(255),
  created_by             INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT open_task_periodic_payload_generation_origin_check
    CHECK (generation_origin IN ('system', 'manual'))
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'periodic_manual_creation_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('bootstrap جهاز قائم', 10, '{"code":"bootstrap_existing_device"}'),
  ('تصحيح جدول الصيانة', 20, '{"code":"schedule_correction"}'),
  ('طلب زيارة خارج الدورة', 30, '{"code":"off_cycle_request"}'),
  ('أخرى', 99, '{"code":"other"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'periodic_manual_creation_reasons'
    AND sl.value = v.value
);

COMMIT;
