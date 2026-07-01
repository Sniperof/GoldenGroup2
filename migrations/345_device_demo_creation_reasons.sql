-- ============================================================
-- 345_device_demo_creation_reasons.sql
-- ============================================================
-- Separates the device-demo task's system reason from the user/admin-managed
-- creation reason. `open_tasks.reason` stays a stable system code, while
-- `open_tasks.creation_reason` stores the operational reason selected from
-- system_lists.
-- ============================================================

BEGIN;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'open_task_reasons', 'device_demo', TRUE, 120, '{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'open_task_reasons'
    AND sl.value = 'device_demo'
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_demo_creation_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('طلب الزبون', 10, '{"allowedOrigins":["manual_creation"],"code":"customer_request"}'),
  ('حملة ترويجية', 20, '{"allowedOrigins":["manual_creation"],"code":"promotional_campaign"}'),
  ('متابعة من التسويق', 30, '{"allowedOrigins":["manual_creation"],"code":"marketing_followup"}'),
  ('ترشيح من مندوب', 40, '{"allowedOrigins":["manual_creation"],"code":"sales_rep_referral"}'),
  ('إعادة تواصل مع زبون سابق', 50, '{"allowedOrigins":["manual_creation"],"code":"returning_customer_followup"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'device_demo_creation_reasons'
    AND sl.value = v.value
);

ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_reason_check;

ALTER TABLE public.open_tasks
  ADD CONSTRAINT open_tasks_reason_check
  CHECK (reason::text = ANY (ARRAY[
    'new_lead',
    'follow_up',
    'renewal',
    'service_request',
    'other',
    'device_demo',
    'sale_delivery',
    'post_maintenance_return',
    'temporary_swap_delivery',
    'replacement_delivery',
    'manual_delivery',
    'golden_warranty_offer',
    'golden_warranty_card_delivery',
    'contract_installment_due',
    'maintenance_receivable_due',
    'golden_warranty_receivable_due',
    'remaining_installment_balance',
    'rescheduled_collection',
    'previous_task_cancelled',
    'manager_followup',
    'data_correction',
    'contract_cancelled',
    'temporary_stop',
    'customer_request',
    'technical_safety',
    'replacement_preparation',
    'maintenance_preparation',
    'device_checkup',
    'manual_checkup',
    'device_retrieval_maintenance',
    'device_retrieval_replacement',
    'device_return_after_maintenance',
    'device_transfer_same_customer_new_address',
    'device_transfer_another_customer'
  ]));

COMMIT;
