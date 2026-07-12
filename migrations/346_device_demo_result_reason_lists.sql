-- 346_device_demo_result_reason_lists.sql
-- Split device_demo result reasons from generic visit/task reason lists.

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_demo_reschedule_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (
  VALUES
    ('طلب الزبون التأجيل', 10),
    ('الزبون غير متوفر', 20),
    ('يحتاج وقت للتفكير', 30),
    ('طلب متابعة لاحقة', 40),
    ('سبب آخر', 99)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_demo_reschedule_reasons'
    AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_demo_cancellation_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (
  VALUES
    ('رفض الزبون العرض', 10),
    ('لم يعد الزبون مهتما', 20),
    ('الزبون خارج نطاق الخدمة', 30),
    ('بيانات الزبون غير صحيحة', 40),
    ('قرار إداري', 50),
    ('سبب آخر', 99)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_demo_cancellation_reasons'
    AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_demo_offer_refusal_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (
  VALUES
    ('السعر غير مناسب', 10),
    ('يريد مقارنة عروض أخرى', 20),
    ('لا يحتاج الجهاز حاليا', 30),
    ('الشروط غير مناسبة', 40),
    ('سبب آخر', 99)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_demo_offer_refusal_reasons'
    AND sl.value = v.value
);

COMMENT ON COLUMN public.visit_task_device_demo_results.reason_code_id IS
  'FK to system_lists. Resolved per final_decision for device_demo only: rescheduled -> device_demo_reschedule_reasons; cancelled -> device_demo_cancellation_reasons. NULL for offer_presented / device_sold.';
