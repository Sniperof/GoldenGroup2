-- 348_device_delivery_creation_reasons.sql
-- Admin-managed creation reasons for device_delivery tasks.

BEGIN;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_delivery_creation_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('تسليم جهاز بعد البيع', 10, '{"label":"تسليم جهاز بعد البيع","systemReason":"sale_delivery"}'),
  ('إرجاع جهاز بعد الصيانة', 20, '{"label":"إرجاع جهاز بعد الصيانة","systemReason":"post_maintenance_return"}'),
  ('تسليم جهاز تبديل مؤقت', 30, '{"label":"تسليم جهاز تبديل مؤقت","systemReason":"temporary_swap_delivery"}'),
  ('تسليم جهاز بديل', 40, '{"label":"تسليم جهاز بديل","systemReason":"replacement_delivery"}'),
  ('إنشاء يدوي', 50, '{"label":"إنشاء يدوي","systemReason":"manual_delivery"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_delivery_creation_reasons'
    AND sl.value = v.value
);

COMMIT;
