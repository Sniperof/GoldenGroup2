-- Migration 201: Financial decisions DEC-CT-06 / 08 / 12
-- ----------------------------------------------------------------------
-- Reference: docs/constitution/contracts/08-resolved-decisions.md
--
-- This migration is intentionally one transaction because the three
-- concerns are tightly coupled by the installment-allocation trigger:
--
--   DEC-CT-08  add entry_type to contract_payment_entries (collection/refund)
--   DEC-CT-06  link payments to installments + auto-maintain
--              installment.paid_amount and remaining_balance
--   DEC-CT-12  installment.collection_owner_id (per-installment owner)
--
-- The `dues` table is NOT dropped here. It stays for one transitional
-- release; /api/dues will be rewritten to read from contract_installments
-- in CT-IMPL-004 (code side). A later cleanup migration drops the table.
-- ----------------------------------------------------------------------

BEGIN;

-- ============================================================
-- DEC-CT-08: entry_type on contract_payment_entries
-- ============================================================
ALTER TABLE contract_payment_entries
  ADD COLUMN IF NOT EXISTS entry_type VARCHAR(20) NOT NULL DEFAULT 'collection';

ALTER TABLE contract_payment_entries
  DROP CONSTRAINT IF EXISTS contract_payment_entries_entry_type_check;

ALTER TABLE contract_payment_entries
  ADD CONSTRAINT contract_payment_entries_entry_type_check
  CHECK (entry_type IN ('collection', 'refund'));

-- ============================================================
-- DEC-CT-06: installment allocation on payment entries
-- ============================================================
-- installment_id is nullable: down-payments and one-off refunds may not
-- target a specific installment.
ALTER TABLE contract_payment_entries
  ADD COLUMN IF NOT EXISTS installment_id INTEGER
    REFERENCES contract_installments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contract_payments_installment
  ON contract_payment_entries(installment_id)
  WHERE installment_id IS NOT NULL;

-- ============================================================
-- DEC-CT-12: collection_owner_id on contract_installments
-- ============================================================
ALTER TABLE contract_installments
  ADD COLUMN IF NOT EXISTS collection_owner_id INTEGER
    REFERENCES hr_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contract_installments_collection_owner
  ON contract_installments(collection_owner_id)
  WHERE collection_owner_id IS NOT NULL;

-- ============================================================
-- DEC-CT-06: maintain paid_amount / remaining_balance / status
-- on contract_installments from payment entries.
-- ============================================================
--
-- A "collection" entry adds to paid_amount; a "refund" subtracts.
-- The trigger recomputes the affected installment(s) after each row
-- INSERT/UPDATE/DELETE.
--
-- Status derivation:
--   remaining <= 0                       -> 'paid'
--   paid > 0 and remaining > 0           -> 'partial'
--   remaining == amount and due_date past-> 'overdue'
--   otherwise                            -> 'pending'

CREATE OR REPLACE FUNCTION recompute_installment_balance(p_installment_id INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_amount    NUMERIC;
  v_due_date  DATE;
  v_paid      NUMERIC;
  v_remaining NUMERIC;
  v_status    VARCHAR(50);
BEGIN
  IF p_installment_id IS NULL THEN RETURN; END IF;

  SELECT amount_syp, due_date INTO v_amount, v_due_date
    FROM contract_installments WHERE id = p_installment_id;

  IF v_amount IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(
           CASE WHEN entry_type = 'refund' THEN -amount_syp ELSE amount_syp END
         ), 0)
    INTO v_paid
    FROM contract_payment_entries
    WHERE installment_id = p_installment_id;

  v_remaining := GREATEST(v_amount - v_paid, 0);

  v_status := CASE
    WHEN v_remaining <= 0                                          THEN 'paid'
    WHEN v_paid > 0 AND v_remaining > 0                            THEN 'partial'
    WHEN v_paid <= 0 AND v_due_date < CURRENT_DATE                 THEN 'overdue'
    ELSE 'pending'
  END;

  UPDATE contract_installments
     SET paid_amount       = v_paid,
         remaining_balance = v_remaining,
         status            = v_status
   WHERE id = p_installment_id;
END;
$$;

CREATE OR REPLACE FUNCTION trg_payment_entry_recompute()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Recompute the new target (INSERT, UPDATE-to)
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.installment_id IS NOT NULL THEN
    PERFORM recompute_installment_balance(NEW.installment_id);
  END IF;

  -- Recompute the old target if it changed or got deleted
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') AND OLD.installment_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.installment_id IS DISTINCT FROM NEW.installment_id) THEN
    PERFORM recompute_installment_balance(OLD.installment_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_payment_entries_recompute
  ON contract_payment_entries;

CREATE TRIGGER trg_contract_payment_entries_recompute
  AFTER INSERT OR UPDATE OR DELETE ON contract_payment_entries
  FOR EACH ROW EXECUTE FUNCTION trg_payment_entry_recompute();

-- ============================================================
-- DEC-CT-01 follow-up: auto-transition contract → completed
-- when all installments on the contract are 'paid'.
-- ============================================================
CREATE OR REPLACE FUNCTION recompute_contract_completion(p_contract_id INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_total      INTEGER;
  v_paid       INTEGER;
  v_status     VARCHAR(50);
BEGIN
  IF p_contract_id IS NULL THEN RETURN; END IF;

  SELECT status INTO v_status FROM contracts WHERE id = p_contract_id;
  -- Only auto-advance from `active`; never override draft/cancelled/discarded.
  IF v_status <> 'active' THEN RETURN; END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'paid')
    INTO v_total, v_paid
    FROM contract_installments
    WHERE contract_id = p_contract_id;

  -- A contract with zero installments is cash-up-front; we don't auto-complete
  -- it from here — that's the caller's responsibility on the cash sale path.
  IF v_total > 0 AND v_total = v_paid THEN
    UPDATE contracts SET status = 'completed' WHERE id = p_contract_id AND status = 'active';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_installment_status_check_completion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    PERFORM recompute_contract_completion(NEW.contract_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_installments_completion
  ON contract_installments;

CREATE TRIGGER trg_contract_installments_completion
  AFTER UPDATE OF status ON contract_installments
  FOR EACH ROW EXECUTE FUNCTION trg_installment_status_check_completion();

COMMIT;
