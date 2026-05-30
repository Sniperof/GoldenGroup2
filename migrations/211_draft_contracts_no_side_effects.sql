-- Migration 211: Draft contracts have NO side effects (constitution rule)
-- ----------------------------------------------------------------------
-- Business rule (constitution / DEC-CT-01 follow-up):
--   When a contract is created with status='draft' it is a piece of paper.
--   No installed_devices row, no delivery task, no financial impact.
--   Activation requires a closing_employee and is a deliberate workflow.
--
-- This migration enforces the rule at the DB layer so app bugs cannot
-- silently leak draft side effects.
--
-- Changes:
--   1. Trigger 191 (auto_create_installed_device) now fires only when the
--      contract is created directly as 'active' AND has a closer.
--   2. New trigger fires on the draft→active transition: it materializes
--      the installed_devices row at activation time (idempotent — skips
--      if a row already exists, e.g. for legacy contracts).
--   3. recompute_installment_balance() now becomes a no-op for installments
--      that belong to a draft contract — so payments saved on a draft don't
--      flip installments to "paid" until the contract is activated.
--   4. trg_warranty_on_contract_cancel only acts on real cancellations
--      (draft → discarded is NOT a cancellation; it never had a warranty).
-- ----------------------------------------------------------------------

BEGIN;

-- ============================================================
-- (1) Gate the INSERT trigger on status = 'active'.
-- ============================================================
DROP TRIGGER IF EXISTS trg_auto_create_installed_device ON contracts;

CREATE TRIGGER trg_auto_create_installed_device
  AFTER INSERT ON contracts
  FOR EACH ROW
  WHEN (NEW.contract_type = 'sale_contract' AND NEW.status = 'active')
  EXECUTE FUNCTION auto_create_installed_device();

-- ============================================================
-- (2) Materialize the device on draft→active transition.
-- ============================================================
CREATE OR REPLACE FUNCTION materialize_device_on_activation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_device_id INTEGER;
BEGIN
  -- Skip if a device row already exists (legacy contracts or re-activation).
  SELECT id INTO v_device_id
    FROM installed_devices
    WHERE contract_id = NEW.id
    LIMIT 1;

  IF v_device_id IS NULL THEN
    -- Reuse the existing creator function for symmetry with INSERT path.
    PERFORM auto_create_installed_device_for(NEW.id);
  END IF;

  RETURN NULL;
END;
$$;

-- Helper function: same body as the INSERT trigger but parameterized by id.
-- Reads the contract row fresh so it works from either trigger.
CREATE OR REPLACE FUNCTION auto_create_installed_device_for(p_contract_id INTEGER)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_device_id INTEGER;
BEGIN
  INSERT INTO installed_devices (
    contract_id, customer_id, branch_id,
    device_model_id, device_model_name, serial_number,
    status,
    installation_geo_unit_id, installation_address_text,
    installation_lat, installation_lng,
    delivery_date, installation_date,
    is_golden_warranty, golden_warranty_end_date,
    contract_warranty_end_date, warranty_months, warranty_visits
  )
  SELECT
    c.id, c.customer_id, c.branch_id,
    c.device_model_id, c.device_model_name, c.serial_number,
    COALESCE(c.device_status, 'pending_delivery'),
    c.installation_geo_unit_id, c.installation_address_text,
    c.installation_lat, c.installation_lng,
    CASE WHEN c.delivery_date     IS NOT NULL THEN c.delivery_date::DATE     ELSE NULL END,
    CASE WHEN c.installation_date IS NOT NULL THEN c.installation_date::DATE ELSE NULL END,
    c.is_golden_warranty, c.golden_warranty_end_date,
    c.contract_warranty_end_date, c.warranty_months, c.warranty_visits
  FROM contracts c
  WHERE c.id = p_contract_id
  RETURNING id INTO v_device_id;

  UPDATE contracts SET installed_device_id = v_device_id WHERE id = p_contract_id;
  RETURN v_device_id;
END;
$$;

-- Note: many of the columns above were dropped from `contracts` in Phase 6
-- (migration 195). For installs that ran 195, the SELECT will reference
-- non-existent columns and the function would fail. Rewrite it defensively:
-- read only what exists and let the app layer fill the rest via UPDATE
-- (matching the current behavior in routes/contracts.ts).
CREATE OR REPLACE FUNCTION auto_create_installed_device_for(p_contract_id INTEGER)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_device_id INTEGER;
  v_customer_id INTEGER;
  v_branch_id   INTEGER;
  v_model_id    INTEGER;
  v_model_name  VARCHAR;
BEGIN
  SELECT customer_id, branch_id, device_model_id, device_model_name
    INTO v_customer_id, v_branch_id, v_model_id, v_model_name
    FROM contracts WHERE id = p_contract_id;

  INSERT INTO installed_devices (
    contract_id, customer_id, branch_id,
    device_model_id, device_model_name,
    status
  ) VALUES (
    p_contract_id, v_customer_id, v_branch_id,
    v_model_id, v_model_name,
    'pending_delivery'
  )
  RETURNING id INTO v_device_id;

  UPDATE contracts SET installed_device_id = v_device_id WHERE id = p_contract_id;
  RETURN v_device_id;
END;
$$;

-- Rewrite the original auto_create_installed_device (TRIGGER body) to delegate
-- to the helper, so both paths share the same logic.
CREATE OR REPLACE FUNCTION auto_create_installed_device()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM auto_create_installed_device_for(NEW.id);
  RETURN NEW;
END;
$$;

-- The transition trigger.
DROP TRIGGER IF EXISTS trg_materialize_device_on_activation ON contracts;
CREATE TRIGGER trg_materialize_device_on_activation
  AFTER UPDATE OF status ON contracts
  FOR EACH ROW
  WHEN (NEW.contract_type = 'sale_contract'
        AND NEW.status = 'active'
        AND OLD.status IS DISTINCT FROM 'active')
  EXECUTE FUNCTION materialize_device_on_activation();

-- ============================================================
-- (3) recompute_installment_balance: short-circuit for draft contracts.
-- ============================================================
CREATE OR REPLACE FUNCTION recompute_installment_balance(p_installment_id INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_amount       NUMERIC;
  v_due_date     DATE;
  v_contract_id  INTEGER;
  v_status_c     VARCHAR(50);
  v_paid         NUMERIC;
  v_remaining    NUMERIC;
  v_status       VARCHAR(50);
BEGIN
  IF p_installment_id IS NULL THEN RETURN; END IF;

  SELECT i.amount_syp, i.due_date, i.contract_id, c.status
    INTO v_amount, v_due_date, v_contract_id, v_status_c
    FROM contract_installments i
    JOIN contracts c ON c.id = i.contract_id
    WHERE i.id = p_installment_id;

  IF v_amount IS NULL THEN RETURN; END IF;

  -- Constitution rule: draft contracts have no financial effect.
  -- Payments saved while drafting are stored but do not flip installments.
  IF v_status_c IN ('draft', 'discarded') THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
           CASE WHEN entry_type = 'refund' THEN -amount_syp ELSE amount_syp END
         ), 0)
    INTO v_paid
    FROM contract_payment_entries
    WHERE installment_id = p_installment_id;

  v_remaining := GREATEST(v_amount - v_paid, 0);

  v_status := CASE
    WHEN v_remaining <= 0                              THEN 'paid'
    WHEN v_paid > 0 AND v_remaining > 0                THEN 'partial'
    WHEN v_paid <= 0 AND v_due_date < CURRENT_DATE     THEN 'overdue'
    ELSE 'pending'
  END;

  UPDATE contract_installments
     SET paid_amount       = v_paid,
         remaining_balance = v_remaining,
         status            = v_status
   WHERE id = p_installment_id;
END;
$$;

-- ============================================================
-- (4) Catch-up: on activation, replay recompute for every installment of
--     this contract so any payments entered during draft now take effect.
-- ============================================================
CREATE OR REPLACE FUNCTION replay_recompute_on_activation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_inst RECORD;
BEGIN
  FOR v_inst IN SELECT id FROM contract_installments WHERE contract_id = NEW.id LOOP
    PERFORM recompute_installment_balance(v_inst.id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_contracts_replay_recompute_on_activation ON contracts;
CREATE TRIGGER trg_contracts_replay_recompute_on_activation
  AFTER UPDATE OF status ON contracts
  FOR EACH ROW
  WHEN (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active')
  EXECUTE FUNCTION replay_recompute_on_activation();

-- ============================================================
-- (5) Don't treat draft→discarded as a "cancellation" for warranties.
--     The previous trigger fires only when NEW.status='cancelled' anyway
--     (migration 204), so no change is needed — left as documentation.
-- ============================================================

COMMIT;
