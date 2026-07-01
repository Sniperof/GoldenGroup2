-- 351_device_service_creation_reasons.sql
-- Admin-managed creation reasons for device service tasks.

BEGIN;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT v.category, v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('device_retrieval_creation_reasons', 'سحب الجهاز للصيانة', 10, '{"label":"سحب الجهاز للصيانة","systemReason":"device_retrieval_maintenance"}'),
  ('device_retrieval_creation_reasons', 'سحب الجهاز للتبديل', 20, '{"label":"سحب الجهاز للتبديل","systemReason":"device_retrieval_replacement"}'),
  ('device_retrieval_creation_reasons', 'إنشاء يدوي', 90, '{"label":"إنشاء يدوي","systemReason":"other"}'),

  ('device_return_creation_reasons', 'إرجاع الجهاز بعد الصيانة', 10, '{"label":"إرجاع الجهاز بعد الصيانة","systemReason":"device_return_after_maintenance"}'),
  ('device_return_creation_reasons', 'إرجاع يدوي', 90, '{"label":"إرجاع يدوي","systemReason":"other"}'),

  ('device_checkup_creation_reasons', 'تشييك فني للجهاز', 10, '{"label":"تشييك فني للجهاز","systemReason":"device_checkup"}'),
  ('device_checkup_creation_reasons', 'طلب الزبون', 20, '{"label":"طلب الزبون","systemReason":"manual_checkup"}'),
  ('device_checkup_creation_reasons', 'إنشاء يدوي', 90, '{"label":"إنشاء يدوي","systemReason":"other"}'),

  ('device_transfer_creation_reasons', 'نقل إلى عنوان جديد لنفس الزبون', 10, '{"label":"نقل إلى عنوان جديد لنفس الزبون","systemReason":"device_transfer_same_customer_new_address"}'),
  ('device_transfer_creation_reasons', 'نقل إلى زبون آخر', 20, '{"label":"نقل إلى زبون آخر","systemReason":"device_transfer_another_customer"}'),
  ('device_transfer_creation_reasons', 'إنشاء يدوي', 90, '{"label":"إنشاء يدوي","systemReason":"other"}'),

  ('device_disconnection_creation_reasons', 'طلب الزبون', 10, '{"label":"طلب الزبون","systemReason":"customer_request"}'),
  ('device_disconnection_creation_reasons', 'إلغاء عقد', 20, '{"label":"إلغاء عقد","systemReason":"contract_cancelled"}'),
  ('device_disconnection_creation_reasons', 'إيقاف مؤقت', 30, '{"label":"إيقاف مؤقت","systemReason":"temporary_stop"}'),
  ('device_disconnection_creation_reasons', 'سلامة فنية', 40, '{"label":"سلامة فنية","systemReason":"technical_safety"}'),
  ('device_disconnection_creation_reasons', 'تحضير تبديل', 50, '{"label":"تحضير تبديل","systemReason":"replacement_preparation"}'),
  ('device_disconnection_creation_reasons', 'تحضير صيانة', 60, '{"label":"تحضير صيانة","systemReason":"maintenance_preparation"}'),
  ('device_disconnection_creation_reasons', 'إنشاء يدوي', 90, '{"label":"إنشاء يدوي","systemReason":"other"}')
) AS v(category, value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = v.category
    AND sl.value = v.value
);

COMMIT;
