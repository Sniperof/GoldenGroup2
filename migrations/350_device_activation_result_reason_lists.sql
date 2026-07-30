-- 350_device_activation_result_reason_lists.sql
-- Split device_activation follow-up reasons into precise failure/reschedule lists.

BEGIN;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_activation_failure_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('pressure_issue', 10, '{"label":"ضغط ماء غير مناسب"}'),
  ('electrical_issue', 20, '{"label":"مشكلة كهرباء"}'),
  ('activation_prerequisite_missing', 30, '{"label":"متطلب تشغيل ناقص"}'),
  ('customer_refused_activation', 40, '{"label":"رفض الزبون إكمال التشغيل"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_activation_failure_reasons'
    AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_activation_reschedule_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('device_fault', 10, '{"label":"عطل في الجهاز"}'),
  ('needs_maintenance_check', 20, '{"label":"بحاجة فحص صيانة"}'),
  ('missing_part_or_accessory', 30, '{"label":"قطعة أو ملحق ناقص"}'),
  ('site_condition_issue', 40, '{"label":"ظرف في الموقع يمنع التشغيل"}'),
  ('other', 99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_activation_reschedule_reasons'
    AND sl.value = v.value
);

COMMIT;
