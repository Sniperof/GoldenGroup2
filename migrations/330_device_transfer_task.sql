-- ============================================================
-- 330_device_transfer_task.sql
-- ============================================================
-- Canonical device transfer task:
--   - Same customer to a preliminary new installation address.
--   - Or possession transfer to another existing customer.
--   - Transfer does not install or activate the device; installation later
--     confirms the final address.
-- ============================================================

BEGIN;

ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS transfer_kind VARCHAR(40),
  ADD COLUMN IF NOT EXISTS target_client_id INTEGER REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planned_transfer_geo_unit_id INTEGER REFERENCES public.geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planned_transfer_address_text TEXT,
  ADD COLUMN IF NOT EXISTS planned_transfer_lat NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS planned_transfer_lng NUMERIC(10, 7);

ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_transfer_kind_check;

ALTER TABLE public.open_tasks
  ADD CONSTRAINT open_tasks_transfer_kind_check
  CHECK (
    transfer_kind IS NULL
    OR transfer_kind IN ('same_customer_new_address', 'another_customer')
  );

UPDATE public.task_type_config
   SET arabic_label = 'نقل الجهاز',
       task_family = 'service',
       scheduling_pattern = 'short_window',
       window_basis = 'due_date',
       planning_window_days = 3,
       contract_required = FALSE,
       allow_multiple = FALSE,
       has_due_date = TRUE,
       display_order = 20,
       is_active = TRUE,
       location_basis = 'device',
       contact_target_visit_type = 'service',
       updated_at = NOW()
 WHERE task_type = 'device_transfer';

INSERT INTO public.task_type_config (
  task_type, task_family, arabic_label, scheduling_pattern, window_basis,
  planning_window_days, contract_required, allow_multiple, has_due_date,
  display_order, is_active, location_basis, contact_target_visit_type
)
SELECT
  'device_transfer', 'service', 'نقل الجهاز', 'short_window', 'due_date',
  3, FALSE, FALSE, TRUE,
  20, TRUE, 'device', 'service'
WHERE NOT EXISTS (
  SELECT 1 FROM public.task_type_config WHERE task_type = 'device_transfer'
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'open_task_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('device_transfer_same_customer_new_address', 734),
  ('device_transfer_another_customer', 735)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'open_task_reasons'
     AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_transfer_refusal_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_refused_transfer', 1, '{"label":"رفض الزبون نقل الجهاز"}'),
  ('target_customer_not_ready', 2, '{"label":"الزبون الجديد غير جاهز للاستلام"}'),
  ('access_blocked', 3, '{"label":"تعذر الوصول إلى الموقع الجديد"}'),
  ('address_not_clear', 4, '{"label":"العنوان الجديد غير واضح"}'),
  ('requires_manager_approval', 5, '{"label":"يتطلب موافقة الإدارة"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'device_transfer_refusal_reasons'
     AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_transfer_reschedule_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_not_available', 1, '{"label":"الزبون غير متوفر"}'),
  ('target_customer_not_available', 2, '{"label":"الزبون الجديد غير متوفر"}'),
  ('technician_not_available', 3, '{"label":"الفني غير متوفر"}'),
  ('vehicle_or_transport_issue', 4, '{"label":"مشكلة نقل أو سيارة"}'),
  ('access_blocked', 5, '{"label":"تعذر الوصول للموقع"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'device_transfer_reschedule_reasons'
     AND sl.value = v.value
);

CREATE TABLE IF NOT EXISTS public.visit_task_device_transfer_results (
  id                         SERIAL PRIMARY KEY,
  visit_task_result_id        INTEGER NOT NULL UNIQUE REFERENCES public.visit_task_results(id) ON DELETE CASCADE,
  final_decision              VARCHAR(100) NOT NULL,
  transfer_kind               VARCHAR(40) NOT NULL,
  from_client_id              INTEGER REFERENCES public.clients(id) ON DELETE SET NULL,
  to_client_id                INTEGER REFERENCES public.clients(id) ON DELETE SET NULL,
  ownership_transferred       BOOLEAN NOT NULL DEFAULT FALSE,
  planned_geo_unit_id         INTEGER REFERENCES public.geo_units(id) ON DELETE SET NULL,
  planned_address_text        TEXT,
  planned_lat                 NUMERIC(10, 7),
  planned_lng                 NUMERIC(10, 7),
  refusal_reason_id           INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  reschedule_reason_id        INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  rescheduled_at              DATE,
  customer_acknowledged       BOOLEAN,
  target_customer_acknowledged BOOLEAN,
  technical_notes             TEXT,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT visit_task_device_transfer_decision_check
    CHECK (final_decision IN ('transferred_successfully', 'reschedule', 'customer_refused_transfer')),
  CONSTRAINT visit_task_device_transfer_kind_check
    CHECK (transfer_kind IN ('same_customer_new_address', 'another_customer'))
);

CREATE INDEX IF NOT EXISTS idx_open_tasks_device_transfer_active
  ON public.open_tasks (device_id)
  WHERE task_type = 'device_transfer'
    AND status NOT IN ('completed', 'closed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_visit_task_device_transfer_to_client
  ON public.visit_task_device_transfer_results (to_client_id);

COMMENT ON TABLE public.visit_task_device_transfer_results IS
  'Canonical side table for device_transfer visit-task results.';

COMMIT;
