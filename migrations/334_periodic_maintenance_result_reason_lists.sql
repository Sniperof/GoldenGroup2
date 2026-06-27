-- 334_periodic_maintenance_result_reason_lists.sql
-- Separate reason lists for periodic maintenance application decisions.

BEGIN;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'periodic_partially_performed_reason', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('رفض الزبون قطعة لازمة', 1),
  ('قطعة لازمة غير متوفرة', 2),
  ('موافقة لاحقة مطلوبة', 3),
  ('تعذر إكمال العمل فنياً', 4),
  ('أخرى', 99)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'periodic_partially_performed_reason'
    AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'periodic_not_performed_reason', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('رفض الزبون تنفيذ الصيانة', 1),
  ('الزبون غير متوفر عند الزيارة', 2),
  ('الجهاز غير متاح للفحص', 3),
  ('ظروف الموقع لا تسمح بالتنفيذ', 4),
  ('قطعة أو عدة أساسية غير متوفرة', 5),
  ('أخرى', 99)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'periodic_not_performed_reason'
    AND sl.value = v.value
);

COMMIT;
