-- ============================================================
-- 319_device_disconnection_task.sql
-- ============================================================
-- Rename the existing device_disconnection operational task from the old
-- "temporary stop" wording to "device disconnection" / فك الجهاز, give it its
-- own Operations & Tasks table permission, and add its canonical result side
-- table.
-- ============================================================

BEGIN;

UPDATE public.task_type_config
   SET arabic_label = 'فك الجهاز',
       task_family = 'service',
       scheduling_pattern = 'short_window',
       window_basis = 'due_date',
       planning_window_days = 3,
       contract_required = TRUE,
       allow_multiple = FALSE,
       has_due_date = TRUE,
       display_order = 19,
       is_active = TRUE,
       location_basis = 'device',
       contact_target_visit_type = 'service',
       updated_at = NOW()
 WHERE task_type = 'device_disconnection';

INSERT INTO public.task_type_config (
  task_type, task_family, arabic_label, scheduling_pattern, window_basis,
  planning_window_days, contract_required, allow_multiple, has_due_date,
  display_order, is_active, location_basis, contact_target_visit_type
)
SELECT
  'device_disconnection', 'service', 'فك الجهاز', 'short_window', 'due_date',
  3, TRUE, FALSE, TRUE,
  19, TRUE, 'device', 'service'
WHERE NOT EXISTS (
  SELECT 1 FROM public.task_type_config WHERE task_type = 'device_disconnection'
);

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('tasks.disconnection.view', 'tasks', 'disconnection', 'view',
      'عرض جدول مهام فك الجهاز', 318, ARRAY['GLOBAL','BRANCH'])
)
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
SELECT key, module, sub_module, action, display_name, display_order, allowed_scopes
FROM source_permissions
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

WITH disconnection_permission AS (
  SELECT id FROM public.permissions WHERE key = 'tasks.disconnection.view'
),
umbrella_grants AS (
  SELECT rpg.role_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'open_tasks.view'
    AND rpg.scope_type IN ('GLOBAL','BRANCH')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT ug.role_id, dp.id, ug.scope_type
FROM umbrella_grants ug
CROSS JOIN disconnection_permission dp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'open_task_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('contract_cancelled', 701),
  ('temporary_stop', 702),
  ('customer_request', 703),
  ('technical_safety', 704),
  ('replacement_preparation', 705),
  ('maintenance_preparation', 706)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'open_task_reasons'
    AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_disconnection_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('contract_cancelled', 1),
  ('temporary_stop', 2),
  ('customer_request', 3),
  ('technical_safety', 4),
  ('replacement_preparation', 5),
  ('maintenance_preparation', 6),
  ('other', 7)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_disconnection_reasons'
    AND sl.value = v.value
);

CREATE TABLE IF NOT EXISTS public.visit_task_device_disconnection_results (
  id                          SERIAL PRIMARY KEY,
  visit_task_result_id         INTEGER NOT NULL UNIQUE REFERENCES public.visit_task_results(id) ON DELETE CASCADE,
  outcome                      VARCHAR(100) NOT NULL,
  device_left_on_site          BOOLEAN NOT NULL DEFAULT TRUE,
  water_disconnected           BOOLEAN NOT NULL DEFAULT FALSE,
  electricity_disconnected     BOOLEAN NOT NULL DEFAULT FALSE,
  accessories_removed          BOOLEAN NOT NULL DEFAULT FALSE,
  customer_acknowledged        BOOLEAN,
  requires_retrieval_task      BOOLEAN NOT NULL DEFAULT FALSE,
  retrieval_reason             VARCHAR(100),
  disconnected_by_employee_id  INTEGER REFERENCES public.employees(id) ON DELETE SET NULL,
  technical_notes              TEXT,
  created_at                   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT visit_task_device_disconnection_outcome_check
    CHECK (outcome IN (
      'disconnected_successfully',
      'not_disconnected',
      'customer_refused_disconnection',
      'requires_retrieval',
      'unsafe_to_disconnect'
    ))
);

COMMIT;
