-- ============================================================
-- 307_golden_warranty_payments.sql
-- ============================================================
-- Phase 2 of the golden-warranty implementation (CT-IMPL-017).
-- Constitution: docs/constitution/contracts/02b-contract-warranties.md §13.6
--                + 08-resolved-decisions.md DEC-CT-17.
--
-- Adds the financial layer for golden warranties:
--   - device_warranties.total_value          (golden has a price; contract = NULL)
--   - device_warranties.offer_task_id         (source task snapshot — golden_warranty_offer)
--   - device_warranties.card_delivery_task_id (source task snapshot — golden_warranty_card_delivery)
--   - device_warranty_payments                (payment entries, mirrors the
--                                               contract_payment_entries / emergency_payment_entries pattern)
--
-- Contract warranty carries NO value and NO payments (it is part of the
-- contract) — enforced by a NOT VALID check so legacy rows are grandfathered.
--
-- Task id columns are loose integers (no FK): warranties are historical and must
-- survive task deletion, consistent with the snapshot pattern (01i §3).
--
-- Idempotent / safe to re-run.
-- ============================================================

-- 1. Golden-warranty columns on device_warranties ----------------------------
ALTER TABLE public.device_warranties
  ADD COLUMN IF NOT EXISTS total_value           NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS offer_task_id          INTEGER,
  ADD COLUMN IF NOT EXISTS card_delivery_task_id  INTEGER;

-- Contract warranty must not carry a value (golden only). NOT VALID: enforced
-- on new/updated rows; any legacy contract row with a value is grandfathered.
ALTER TABLE public.device_warranties
  DROP CONSTRAINT IF EXISTS device_warranties_contract_no_value_ck;
ALTER TABLE public.device_warranties
  ADD CONSTRAINT device_warranties_contract_no_value_ck
  CHECK (warranty_type = 'golden' OR total_value IS NULL) NOT VALID;

-- 2. device_warranty_payments — mirrors the established payment-entries pattern
CREATE TABLE IF NOT EXISTS public.device_warranty_payments (
  id                     SERIAL PRIMARY KEY,
  warranty_id            INTEGER NOT NULL REFERENCES public.device_warranties(id) ON DELETE CASCADE,
  method                 VARCHAR(50) NOT NULL,
  currency               VARCHAR(10) NOT NULL DEFAULT 'SYP',
  amount_value           NUMERIC(12,2) NOT NULL,
  exchange_rate          NUMERIC,
  amount_syp             NUMERIC(12,2) NOT NULL,
  reference_number       VARCHAR(255),
  barter_name            VARCHAR(255),
  barter_value_syp       NUMERIC,
  transfer_company_id    INTEGER,
  received_by_employee_id INTEGER,
  received_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes                  TEXT,
  entry_type             VARCHAR(20) NOT NULL DEFAULT 'collection',
  created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT device_warranty_payments_amount_value_check     CHECK (amount_value >= 0),
  CONSTRAINT device_warranty_payments_amount_syp_check       CHECK (amount_syp >= 0),
  CONSTRAINT device_warranty_payments_barter_value_syp_check CHECK (barter_value_syp IS NULL OR barter_value_syp >= 0),
  CONSTRAINT device_warranty_payments_exchange_rate_check     CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  CONSTRAINT device_warranty_payments_entry_type_check        CHECK (entry_type IN ('collection', 'refund')),
  CONSTRAINT device_warranty_payments_method_check
    CHECK (method IN ('cash','sham_cash','syriatel_cash','mtn_cash','alharam','bank_transfer','barter','usd_cash'))
);

CREATE INDEX IF NOT EXISTS idx_device_warranty_payments_warranty
  ON public.device_warranty_payments(warranty_id, received_at DESC);
