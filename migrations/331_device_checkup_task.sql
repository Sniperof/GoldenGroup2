-- ============================================================
-- 331_device_checkup_task.sql
-- ============================================================
-- Canonical device checkup task:
--   - Records a single diagnostic technical-state reading.
--   - Does not change device status, possession, contract, or address.
-- ============================================================

BEGIN;

UPDATE public.task_type_config
   SET arabic_label = 'تشييك الجهاز',
       task_family = 'service',
       scheduling_pattern = 'short_window',
       window_basis = 'due_date',
       planning_window_days = 3,
       contract_required = FALSE,
       allow_multiple = FALSE,
       has_due_date = TRUE,
       display_order = 17,
       is_active = TRUE,
       location_basis = 'device',
       contact_target_visit_type = 'service',
       updated_at = NOW()
 WHERE task_type = 'device_checkup';

INSERT INTO public.task_type_config (
  task_type, task_family, arabic_label, scheduling_pattern, window_basis,
  planning_window_days, contract_required, allow_multiple, has_due_date,
  display_order, is_active, location_basis, contact_target_visit_type
)
SELECT
  'device_checkup', 'service', 'تشييك الجهاز', 'short_window', 'due_date',
  3, FALSE, FALSE, TRUE,
  17, TRUE, 'device', 'service'
WHERE NOT EXISTS (
  SELECT 1 FROM public.task_type_config WHERE task_type = 'device_checkup'
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'open_task_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('device_checkup', 730)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'open_task_reasons'
     AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_checkup_refusal_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_refused_checkup', 1, '{"label":"رفض الزبون تشييك الجهاز"}'),
  ('device_not_accessible', 2, '{"label":"تعذر الوصول إلى الجهاز"}'),
  ('customer_not_ready', 3, '{"label":"الزبون غير جاهز للتشييك"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'device_checkup_refusal_reasons'
     AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_checkup_reschedule_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_not_available', 1, '{"label":"الزبون غير متوفر"}'),
  ('technician_not_available', 2, '{"label":"الفني غير متوفر"}'),
  ('device_not_accessible', 3, '{"label":"تعذر الوصول إلى الجهاز"}'),
  ('needs_later_visit', 4, '{"label":"بحاجة إلى موعد لاحق"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'device_checkup_reschedule_reasons'
     AND sl.value = v.value
);

CREATE TABLE IF NOT EXISTS public.visit_task_device_checkup_results (
  id                         SERIAL PRIMARY KEY,
  visit_task_result_id        INTEGER NOT NULL UNIQUE REFERENCES public.visit_task_results(id) ON DELETE CASCADE,
  final_decision              VARCHAR(100) NOT NULL DEFAULT 'checked_successfully',
  technical_state_id          INTEGER REFERENCES public.device_technical_states(id) ON DELETE RESTRICT,
  refusal_reason_id           INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  reschedule_reason_id        INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  rescheduled_at              DATE,
  technical_notes             TEXT,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT visit_task_device_checkup_decision_check
    CHECK (final_decision IN ('checked_successfully', 'reschedule', 'customer_refused_checkup')),
  CONSTRAINT visit_task_device_checkup_success_state_check
    CHECK (final_decision <> 'checked_successfully' OR technical_state_id IS NOT NULL)
);

ALTER TABLE public.visit_task_device_checkup_results
  ADD COLUMN IF NOT EXISTS final_decision VARCHAR(100) NOT NULL DEFAULT 'checked_successfully',
  ALTER COLUMN technical_state_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS refusal_reason_id INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reschedule_reason_id INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_at DATE;

ALTER TABLE public.visit_task_device_checkup_results
  DROP CONSTRAINT IF EXISTS visit_task_device_checkup_decision_check,
  DROP CONSTRAINT IF EXISTS visit_task_device_checkup_success_state_check;

ALTER TABLE public.visit_task_device_checkup_results
  ADD CONSTRAINT visit_task_device_checkup_decision_check
    CHECK (final_decision IN ('checked_successfully', 'reschedule', 'customer_refused_checkup')),
  ADD CONSTRAINT visit_task_device_checkup_success_state_check
    CHECK (final_decision <> 'checked_successfully' OR technical_state_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_open_tasks_device_checkup_active
  ON public.open_tasks (device_id)
  WHERE task_type = 'device_checkup'
    AND status NOT IN ('completed', 'closed', 'cancelled');

COMMENT ON TABLE public.visit_task_device_checkup_results IS
  'Canonical side table for device_checkup results; points to the diagnostic technical-state reading.';

COMMIT;
