-- ============================================================
-- 361_gift_delivery_open_task_reason.sql
-- ============================================================
-- Gift delivery tasks are created from gift_records with
-- open_tasks.reason = 'gift_delivery'. The system list already has the task
-- type, but the open_tasks.reason CHECK constraint was last rebuilt without
-- this reason, causing gift delivery task creation to fail.
-- ============================================================

BEGIN;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'open_task_reasons', 'gift_delivery', TRUE, 125, '{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'open_task_reasons'
    AND sl.value = 'gift_delivery'
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'gift_delivery_creation_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('تسليم هدية معتمدة', 10, '{"label":"تسليم هدية معتمدة","systemReason":"gift_delivery"}'),
  ('متابعة وعد هدية', 20, '{"label":"متابعة وعد هدية","systemReason":"gift_delivery"}'),
  ('قرار إداري بتسليم الهدية', 30, '{"label":"قرار إداري بتسليم الهدية","systemReason":"gift_delivery"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'gift_delivery_creation_reasons'
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
    'gift_delivery',
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

CREATE INDEX IF NOT EXISTS idx_gift_records_delivery_task
  ON public.gift_records (delivery_task_id);

COMMIT;
