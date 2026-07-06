-- 356_service_request_resolve_at_intake_reason_lists.sql
-- ============================================================
-- Moves "resolved at intake" outcomes from hard-coded UI/state-machine
-- arrays into admin-managed system_lists, separated by service request type.
-- ============================================================

BEGIN;

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_triage_outcome_check;

ALTER TABLE public.service_requests
  ADD CONSTRAINT service_requests_triage_outcome_check
  CHECK (triage_outcome IS NULL OR btrim(triage_outcome) <> '');

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'service_request_resolve_at_intake_emergency_maintenance', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('resolved_by_advice', 10, '{"label":"حُلَّ بنصيحة هاتفية","description":"الفني وصف خطوات على الهاتف وحُلَّ العطل"}'),
  ('customer_self_fixed', 20, '{"label":"الزبون حلَّه ذاتياً","description":"الزبون أصلحه قبل وصولنا"}'),
  ('false_alarm', 30, '{"label":"إنذار خاطئ","description":"لم يكن هناك عطل فعلاً"}'),
  ('info_clarified_no_issue', 40, '{"label":"استيضاح بلا عطل","description":"كان استفساراً لا مشكلة"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'service_request_resolve_at_intake_emergency_maintenance'
    AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'service_request_resolve_at_intake_water_check', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('water_check_advice_provided', 10, '{"label":"تم إعطاء إرشاد فحص المياه","description":"تم توجيه الزبون هاتفياً ولا حاجة لإنشاء مهمة عرض جهاز"}'),
  ('water_check_question_answered', 20, '{"label":"تمت الإجابة عن استفسار المياه","description":"كان الطلب استفساراً وتم توضيح المعلومات المطلوبة"}'),
  ('water_check_not_needed', 30, '{"label":"لم يعد الفحص مطلوباً","description":"الزبون صرف النظر عن طلب الفحص أثناء الاستلام"}'),
  ('water_check_info_clarified_no_task', 40, '{"label":"استيضاح بلا مهمة","description":"تم حسم الطلب من بيانات الاستلام دون الحاجة لمتابعة تشغيلية"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'service_request_resolve_at_intake_water_check'
    AND sl.value = v.value
);

COMMIT;
