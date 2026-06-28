-- ============================================================
-- 340_open_tasks_reason_check_device_tasks.sql
-- ============================================================
-- Fix schema drift for open_tasks.reason.
-- New task flows (device_checkup, device_retrieval, device_return,
-- device_transfer, etc.) already validate against system_lists and the API,
-- but the DB CHECK constraint was still limited to the legacy set.
-- This migration realigns the constraint with the reasons currently used by
-- open_tasks.create and the seeded open_task_reasons list.
-- ============================================================

BEGIN;

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
