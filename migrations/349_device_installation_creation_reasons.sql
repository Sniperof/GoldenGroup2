-- 349_device_installation_creation_reasons.sql
-- Admin-managed creation reasons for device_installation tasks.

BEGIN;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_installation_creation_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('إنشاء يدوي من حالة الجهاز', 10, '{"label":"إنشاء يدوي من حالة الجهاز","systemReason":"other"}'),
  ('تركيب بعد نجاح التسليم', 20, '{"label":"تركيب بعد نجاح التسليم","systemReason":"service_request"}'),
  ('متابعة ما بعد البيع', 30, '{"label":"متابعة ما بعد البيع","systemReason":"service_request"}'),
  ('تصحيح بيانات التركيب', 40, '{"label":"تصحيح بيانات التركيب","systemReason":"other"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_installation_creation_reasons'
    AND sl.value = v.value
);

COMMIT;
