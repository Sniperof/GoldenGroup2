-- 347_maintenance_reschedule_reason_lists.sql
-- Split maintenance reschedule reasons by task type.

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'emergency_maintenance_reschedule_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (
  VALUES
    ('الزبون غير متوفر', 10),
    ('طلب الزبون موعدا لاحقا', 20),
    ('انتظار قطعة', 30),
    ('تحتاج فني متخصص', 40),
    ('تعذر الوصول للموقع', 50),
    ('سبب آخر', 99)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'emergency_maintenance_reschedule_reasons'
    AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'periodic_maintenance_reschedule_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (
  VALUES
    ('الزبون غير متوفر', 10),
    ('طلب الزبون تأجيل الزيارة', 20),
    ('الجهاز غير متاح للفحص', 30),
    ('ازدحام جدول الفريق', 40),
    ('تعذر الوصول للموقع', 50),
    ('سبب آخر', 99)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'periodic_maintenance_reschedule_reasons'
    AND sl.value = v.value
);
