-- ============================================================
-- 316_golden_warranty_installments.sql
-- ============================================================
-- Phase 3 of the golden-warranty implementation (CT-IMPL-017).
-- Constitution: docs/constitution/contracts/02b-contract-warranties.md §13.6
--                + 08-resolved-decisions.md DEC-CT-17.
--
-- Adds installment support for golden warranties paid by installment, mirroring
-- the contract_installments / contract_payment_entries.installment_id pattern:
--   - device_warranties.payment_type        ('cash' | 'installment')
--   - device_warranties.installments_count   (NULL for cash)
--   - device_warranty_installments           (schedule rows, mirrors contract_installments)
--   - device_warranty_payments.installment_id (a payment may settle an installment)
--
-- Contract warranty is always cash-equivalent (no value, no installments) —
-- enforced by a NOT VALID check so legacy rows are grandfathered.
--
-- Idempotent / safe to re-run.
-- ============================================================

-- 1. payment_type + installments_count on device_warranties -------------------
ALTER TABLE public.device_warranties
  ADD COLUMN IF NOT EXISTS payment_type       VARCHAR(20) NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS installments_count INTEGER;

ALTER TABLE public.device_warranties
  DROP CONSTRAINT IF EXISTS device_warranties_payment_type_ck;
ALTER TABLE public.device_warranties
  ADD CONSTRAINT device_warranties_payment_type_ck
  CHECK (payment_type IN ('cash', 'installment'));

-- Contract warranty never carries installments (golden only). NOT VALID:
-- enforced on new/updated rows; legacy contract rows are grandfathered.
ALTER TABLE public.device_warranties
  DROP CONSTRAINT IF EXISTS device_warranties_contract_no_installments_ck;
ALTER TABLE public.device_warranties
  ADD CONSTRAINT device_warranties_contract_no_installments_ck
  CHECK (warranty_type = 'golden' OR payment_type = 'cash') NOT VALID;

-- 2. device_warranty_installments — mirrors contract_installments -------------
CREATE TABLE IF NOT EXISTS public.device_warranty_installments (
  id                 SERIAL PRIMARY KEY,
  warranty_id        INTEGER NOT NULL REFERENCES public.device_warranties(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  due_date           DATE NOT NULL,
  amount_syp         NUMERIC(12,2) NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending',
  paid_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_balance  NUMERIC(12,2) NOT NULL DEFAULT 0,
  confirmed          BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT device_warranty_installments_amount_syp_check CHECK (amount_syp >= 0),
  CONSTRAINT device_warranty_installments_status_check
    CHECK (status IN ('pending', 'paid', 'partial', 'overdue'))
);

CREATE INDEX IF NOT EXISTS idx_device_warranty_installments_warranty
  ON public.device_warranty_installments(warranty_id, installment_number);

-- 3. Optional link from a payment to the installment it settles ---------------
ALTER TABLE public.device_warranty_payments
  ADD COLUMN IF NOT EXISTS installment_id INTEGER
    REFERENCES public.device_warranty_installments(id) ON DELETE SET NULL;
