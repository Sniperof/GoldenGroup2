-- ============================================================
-- 324_device_return_task.sql
-- ============================================================
-- Canonical device return task:
--   - Only after a successful maintenance retrieval.
--   - Source is the device's current workshop/service branch.
--   - Destination is the installation address captured before retrieval.
--   - Successful return marks the device delivered.
-- ============================================================

BEGIN;

UPDATE public.task_type_config
   SET arabic_label = 'إرجاع الجهاز',
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
 WHERE task_type = 'device_return';

INSERT INTO public.task_type_config (
  task_type, task_family, arabic_label, scheduling_pattern, window_basis,
  planning_window_days, contract_required, allow_multiple, has_due_date,
  display_order, is_active, location_basis, contact_target_visit_type
)
SELECT
  'device_return', 'service', 'إرجاع الجهاز', 'short_window', 'due_date',
  3, TRUE, FALSE, TRUE,
  19, TRUE, 'device', 'service'
WHERE NOT EXISTS (
  SELECT 1 FROM public.task_type_config WHERE task_type = 'device_return'
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'open_task_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('device_return_after_maintenance', 733)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'open_task_reasons'
     AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_return_refusal_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_denied_receipt', 1, '{"label":"رفض الزبون استلام الجهاز"}'),
  ('customer_not_ready', 2, '{"label":"الزبون غير جاهز للاستلام"}'),
  ('dispute_on_device_condition', 3, '{"label":"خلاف على حالة الجهاز"}'),
  ('requires_manager_approval', 4, '{"label":"يتطلب موافقة الإدارة"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'device_return_refusal_reasons'
     AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_return_reschedule_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_not_available', 1, '{"label":"الزبون غير متوفر"}'),
  ('technician_not_available', 2, '{"label":"الفني غير متوفر"}'),
  ('vehicle_or_transport_issue', 3, '{"label":"مشكلة نقل أو سيارة"}'),
  ('access_blocked', 4, '{"label":"تعذر الوصول لموقع التركيب"}'),
  ('device_not_ready', 5, '{"label":"الجهاز غير جاهز للخروج من الورشة"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'device_return_reschedule_reasons'
     AND sl.value = v.value
);

CREATE TABLE IF NOT EXISTS public.visit_task_device_return_results (
  id                         SERIAL PRIMARY KEY,
  visit_task_result_id        INTEGER NOT NULL UNIQUE REFERENCES public.visit_task_results(id) ON DELETE CASCADE,
  final_decision              VARCHAR(100) NOT NULL,
  source_retrieval_task_id    INTEGER REFERENCES public.open_tasks(id) ON DELETE SET NULL,
  restored_branch_id          INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  restored_geo_unit_id        INTEGER REFERENCES public.geo_units(id) ON DELETE SET NULL,
  restored_address_text       TEXT,
  restored_lat                NUMERIC(10, 7),
  restored_lng                NUMERIC(10, 7),
  actual_return_date          DATE,
  refusal_reason_id           INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  reschedule_reason_id        INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  rescheduled_at              DATE,
  customer_acknowledged       BOOLEAN,
  technical_notes             TEXT,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT visit_task_device_return_decision_check
    CHECK (final_decision IN ('returned_successfully', 'reschedule', 'customer_refused_return'))
);

CREATE INDEX IF NOT EXISTS idx_open_tasks_device_return_active
  ON public.open_tasks (device_id)
  WHERE task_type = 'device_return'
    AND status NOT IN ('completed', 'closed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_visit_task_device_return_source_retrieval
  ON public.visit_task_device_return_results (source_retrieval_task_id);

COMMENT ON TABLE public.visit_task_device_return_results IS
  'Canonical side table for device_return visit-task results.';

COMMIT;
