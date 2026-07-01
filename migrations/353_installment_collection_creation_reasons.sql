-- 353_installment_collection_creation_reasons.sql
-- Admin-managed creation reasons for installment_collection tasks.

BEGIN;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'installment_collection_creation_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('استحقاق قسط عقد', 10, '{"label":"استحقاق قسط عقد","systemReason":"contract_installment_due"}'),
  ('ذمة صيانة مستحقة', 20, '{"label":"ذمة صيانة مستحقة","systemReason":"maintenance_receivable_due"}'),
  ('ذمة كفالة ذهبية مستحقة', 30, '{"label":"ذمة كفالة ذهبية مستحقة","systemReason":"golden_warranty_receivable_due"}'),
  ('متابعة رصيد متبق بعد دفعة جزئية', 40, '{"label":"متابعة رصيد متبق بعد دفعة جزئية","systemReason":"remaining_installment_balance"}'),
  ('إعادة جدولة التحصيل', 50, '{"label":"إعادة جدولة التحصيل","systemReason":"rescheduled_collection"}'),
  ('إعادة فتح بعد إلغاء سابق', 60, '{"label":"إعادة فتح بعد إلغاء سابق","systemReason":"previous_task_cancelled"}'),
  ('متابعة إدارية', 70, '{"label":"متابعة إدارية","systemReason":"manager_followup"}'),
  ('تصحيح بيانات', 80, '{"label":"تصحيح بيانات","systemReason":"data_correction"}'),
  ('إنشاء يدوي', 90, '{"label":"إنشاء يدوي","systemReason":"other"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'installment_collection_creation_reasons'
    AND sl.value = v.value
);

COMMIT;
