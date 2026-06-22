-- ============================================================
-- 310_open_tasks_reason_golden_warranty.sql
-- ============================================================
-- open_tasks.reason has a DB-level CHECK constraint enumerating allowed reasons.
-- Extend it with the golden-warranty offer/card-delivery reasons so the device
-- page can spawn those tasks. Constitution: 02b §13.6 + DEC-CT-17 (CT-IMPL-017).
--
-- Idempotent / safe to re-run.
-- ============================================================

ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_reason_check;

ALTER TABLE public.open_tasks
  ADD CONSTRAINT open_tasks_reason_check
  CHECK (reason::text = ANY (ARRAY[
    'new_lead', 'follow_up', 'renewal', 'service_request', 'other',
    'sale_delivery', 'post_maintenance_return', 'temporary_swap_delivery',
    'replacement_delivery', 'manual_delivery',
    'golden_warranty_offer', 'golden_warranty_card_delivery'
  ]::text[]));
