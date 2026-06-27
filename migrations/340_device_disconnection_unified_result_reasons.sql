-- 340_device_disconnection_unified_result_reasons.sql
-- Unify device_disconnection results into: disconnected, rescheduled, disconnection_failed.
-- `requires_retrieval_task` remains a flag on successful disconnection, not a final decision.

BEGIN;

ALTER TABLE public.visit_task_device_disconnection_results
  ADD COLUMN IF NOT EXISTS reschedule_reason_id INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS failure_reason_id INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_at DATE;

ALTER TABLE public.visit_task_device_disconnection_results
  DROP CONSTRAINT IF EXISTS visit_task_device_disconnection_outcome_check;

ALTER TABLE public.visit_task_device_disconnection_results
  ADD CONSTRAINT visit_task_device_disconnection_outcome_check
  CHECK (outcome IN (
    'disconnected_successfully',
    'rescheduled',
    'disconnection_failed',
    -- Legacy values retained for existing historical rows.
    'not_disconnected',
    'customer_refused_disconnection',
    'requires_retrieval',
    'unsafe_to_disconnect'
  ));

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_disconnection_reschedule_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_not_available', 1, '{"label":"الزبون غير متوفر"}'),
  ('customer_requested_later', 2, '{"label":"الزبون طلب موعدا لاحقا"}'),
  ('technical_prerequisite_missing', 3, '{"label":"متطلب فني غير جاهز"}'),
  ('unsafe_currently', 4, '{"label":"الظرف غير آمن حاليا"}'),
  ('team_capacity', 5, '{"label":"تعذر التنفيذ بسبب جدول الفريق"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_disconnection_reschedule_reasons'
    AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_disconnection_failure_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('customer_refused_disconnection', 1, '{"label":"رفض الزبون تنفيذ الفك"}'),
  ('unsafe_to_disconnect', 2, '{"label":"تعذر الفك لسبب أمان"}'),
  ('technical_blocker', 3, '{"label":"مانع فني يمنع الفك"}'),
  ('contract_or_approval_issue', 4, '{"label":"مشكلة عقد أو موافقة"}'),
  ('cancelled_by_company', 5, '{"label":"إلغاء من الشركة"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_disconnection_failure_reasons'
    AND sl.value = v.value
);

COMMIT;
