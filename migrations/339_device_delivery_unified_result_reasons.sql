-- 339_device_delivery_unified_result_reasons.sql
-- Unify device_delivery results into: delivered, rescheduled, delivery_failed.
-- Keep legacy outcomes accepted for historical rows and rollback-safe reads.

BEGIN;

ALTER TABLE public.visit_task_device_delivery_results
  ADD COLUMN IF NOT EXISTS reschedule_reason_id INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS failure_reason_id INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_at DATE;

ALTER TABLE public.visit_task_device_delivery_results
  DROP CONSTRAINT IF EXISTS visit_task_device_delivery_results_outcome_check;

ALTER TABLE public.visit_task_device_delivery_results
  ADD CONSTRAINT visit_task_device_delivery_results_outcome_check
  CHECK (outcome IN (
    'delivered_successfully',
    'rescheduled',
    'delivery_failed',
    -- Legacy values retained for existing historical rows.
    'customer_not_available',
    'wrong_address',
    'refused_delivery'
  ));

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_delivery_reschedule_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_not_available', 1, '{"label":"الزبون غير متوفر"}'),
  ('wrong_address', 2, '{"label":"العنوان غير صحيح"}'),
  ('customer_requested_later', 3, '{"label":"الزبون طلب موعداً لاحقاً"}'),
  ('team_capacity', 4, '{"label":"تعذر التنفيذ بسبب جدول الفريق"}'),
  ('weather_or_road', 5, '{"label":"ظرف طريق أو طقس"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_delivery_reschedule_reasons'
    AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_delivery_failure_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_refused_delivery', 1, '{"label":"رفض الزبون استلام الجهاز"}'),
  ('contract_or_payment_issue', 2, '{"label":"مشكلة عقد أو دفعة"}'),
  ('device_not_ready', 3, '{"label":"الجهاز غير جاهز للتسليم"}'),
  ('address_unserviceable', 4, '{"label":"العنوان غير قابل للتنفيذ"}'),
  ('cancelled_by_company', 5, '{"label":"إلغاء من الشركة"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_delivery_failure_reasons'
    AND sl.value = v.value
);

COMMIT;
