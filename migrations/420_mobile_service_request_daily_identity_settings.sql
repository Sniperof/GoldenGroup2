BEGIN;

INSERT INTO public.system_settings
  (key, value, value_type, category, description, is_editable, updated_at)
VALUES
  ('water_check_daily_per_identity', '5', 'integer', 'service_requests', 'السقف خلال 24 ساعة لطلبات فحص المياه لكل هوية أو جهاز', TRUE, NOW()),
  ('emergency_maintenance_daily_per_identity', '5', 'integer', 'service_requests', 'السقف خلال 24 ساعة لطلبات الصيانة الطارئة لكل هوية أو جهاز', TRUE, NOW()),
  ('device_request_daily_per_identity', '5', 'integer', 'service_requests', 'السقف خلال 24 ساعة لطلبات الأجهزة لكل هوية أو جهاز', TRUE, NOW()),
  ('periodic_maintenance_daily_per_identity', '5', 'integer', 'service_requests', 'السقف خلال 24 ساعة لطلبات الصيانة الدورية لكل هوية أو جهاز', TRUE, NOW()),
  ('golden_warranty_daily_per_identity', '5', 'integer', 'service_requests', 'السقف خلال 24 ساعة لطلبات الضمان الذهبي لكل هوية أو جهاز', TRUE, NOW()),
  ('name_nomination_daily_per_identity', '5', 'integer', 'service_requests', 'السقف خلال 24 ساعة لطلبات ترشيح الأسماء لكل هوية أو جهاز', TRUE, NOW()),
  ('agent_license_daily_per_identity', '5', 'integer', 'service_requests', 'السقف خلال 24 ساعة لطلبات ترخيص الوكيل لكل هوية أو جهاز', TRUE, NOW())
ON CONFLICT (key) DO UPDATE
SET value_type = EXCLUDED.value_type,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    is_editable = EXCLUDED.is_editable,
    updated_at = NOW();

COMMIT;
