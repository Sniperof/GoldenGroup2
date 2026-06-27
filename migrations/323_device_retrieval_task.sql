-- ============================================================
-- 323_device_retrieval_task.sql
-- ============================================================
-- Canonical device retrieval task:
--   - Retrieval is only toward a service branch.
--   - Purpose is maintenance or replacement.
--   - A successful maintenance retrieval moves the device to in_workshop.
--   - A successful replacement retrieval marks the old device retrieved.
-- ============================================================

BEGIN;

ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS service_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retrieval_purpose VARCHAR(32),
  ADD COLUMN IF NOT EXISTS pre_retrieval_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pre_retrieval_geo_unit_id INTEGER REFERENCES public.geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pre_retrieval_address_text TEXT,
  ADD COLUMN IF NOT EXISTS pre_retrieval_lat NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS pre_retrieval_lng NUMERIC(10, 7);

ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_retrieval_purpose_check;

ALTER TABLE public.open_tasks
  ADD CONSTRAINT open_tasks_retrieval_purpose_check
  CHECK (
    retrieval_purpose IS NULL
    OR retrieval_purpose IN ('maintenance', 'replacement')
  );

UPDATE public.task_type_config
   SET arabic_label = 'سحب الجهاز',
       task_family = 'service',
       scheduling_pattern = 'short_window',
       window_basis = 'due_date',
       planning_window_days = 3,
       contract_required = TRUE,
       allow_multiple = FALSE,
       has_due_date = TRUE,
       display_order = 18,
       is_active = TRUE,
       location_basis = 'device',
       contact_target_visit_type = 'service',
       updated_at = NOW()
 WHERE task_type = 'device_retrieval';

INSERT INTO public.task_type_config (
  task_type, task_family, arabic_label, scheduling_pattern, window_basis,
  planning_window_days, contract_required, allow_multiple, has_due_date,
  display_order, is_active, location_basis, contact_target_visit_type
)
SELECT
  'device_retrieval', 'service', 'سحب الجهاز', 'short_window', 'due_date',
  3, TRUE, FALSE, TRUE,
  18, TRUE, 'device', 'service'
WHERE NOT EXISTS (
  SELECT 1 FROM public.task_type_config WHERE task_type = 'device_retrieval'
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'open_task_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('device_retrieval_maintenance', 731),
  ('device_retrieval_replacement', 732)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'open_task_reasons'
     AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_retrieval_refusal_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_denied_access', 1, '{"label":"رفض السماح بالدخول"}'),
  ('customer_denied_handover', 2, '{"label":"رفض تسليم الجهاز"}'),
  ('customer_requires_manager_approval', 3, '{"label":"طلب موافقة الإدارة"}'),
  ('dispute_on_device_or_accessories', 4, '{"label":"خلاف على الجهاز أو الملحقات"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'device_retrieval_refusal_reasons'
     AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_retrieval_reschedule_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_not_available', 1, '{"label":"الزبون غير متوفر"}'),
  ('technician_not_available', 2, '{"label":"الفني غير متوفر"}'),
  ('vehicle_or_transport_issue', 3, '{"label":"مشكلة نقل أو سيارة"}'),
  ('access_blocked', 4, '{"label":"تعذر الوصول للموقع"}'),
  ('weather_or_safety_issue', 5, '{"label":"ظرف أمان أو طقس"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'device_retrieval_reschedule_reasons'
     AND sl.value = v.value
);

CREATE TABLE IF NOT EXISTS public.visit_task_device_retrieval_results (
  id                         SERIAL PRIMARY KEY,
  visit_task_result_id        INTEGER NOT NULL UNIQUE REFERENCES public.visit_task_results(id) ON DELETE CASCADE,
  final_decision              VARCHAR(100) NOT NULL,
  retrieval_purpose           VARCHAR(32) NOT NULL,
  service_branch_id           INTEGER NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  refusal_reason_id           INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  reschedule_reason_id        INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  rescheduled_at              DATE,
  customer_acknowledged       BOOLEAN,
  technical_notes             TEXT,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT visit_task_device_retrieval_decision_check
    CHECK (final_decision IN ('retrieved_successfully', 'reschedule', 'customer_refused_retrieval')),
  CONSTRAINT visit_task_device_retrieval_purpose_check
    CHECK (retrieval_purpose IN ('maintenance', 'replacement'))
);

CREATE INDEX IF NOT EXISTS idx_open_tasks_device_retrieval_active
  ON public.open_tasks (device_id)
  WHERE task_type = 'device_retrieval'
    AND status NOT IN ('completed', 'closed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_visit_task_device_retrieval_service_branch
  ON public.visit_task_device_retrieval_results (service_branch_id);

COMMENT ON TABLE public.visit_task_device_retrieval_results IS
  'Canonical side table for device_retrieval visit-task results.';

COMMIT;
