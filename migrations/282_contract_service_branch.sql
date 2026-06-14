-- ============================================================
-- 282_contract_service_branch.sql
-- ============================================================
-- Separate the registration/sale branch from the SERVICE branch on contracts.
--
-- Background (DEC-001 reconciliation): "service branch" is the branch that
-- physically services the contract's device (delivery, install, maintenance).
-- DEC-001 keeps the *live* service branch on installed_devices.branch_id. This
-- migration adds a contract-level *planned/registered* service branch that is
-- available from contract creation (incl. drafts, before the device row exists),
-- and seeds installed_devices.branch_id from it at materialization.
--
-- Layering:
--   contracts.branch_id          → registration / sale branch (revenue owner)
--   contracts.service_branch_id  → planned service branch (NEW — seeds device)
--   installed_devices.branch_id  → live service branch (authoritative once set)
--
-- For now service_branch_id defaults to the contract's own branch_id, so existing
-- behavior is unchanged (service = sale = client = entering employee branch).
--
-- Idempotent / safe to re-run.
-- ============================================================

BEGIN;

-- 1. New column. Nullable so drafts/legacy rows don't break; COALESCE-defaulted
--    everywhere it is consumed. RESTRICT mirrors contracts.branch_id semantics.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS service_branch_id INTEGER
    REFERENCES public.branches(id) ON DELETE RESTRICT;

-- 2. Backfill existing contracts: service branch = sale branch (current reality).
UPDATE public.contracts
  SET service_branch_id = branch_id
  WHERE service_branch_id IS NULL;

-- 3. Re-point the device materialization trigger to seed installed_devices.branch_id
--    from the contract's SERVICE branch (falling back to the sale branch).
CREATE OR REPLACE FUNCTION public.auto_create_installed_device_for(p_contract_id integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_device_id   INTEGER;
  v_customer_id INTEGER;
  v_branch_id   INTEGER;
  v_model_id    INTEGER;
  v_model_name  VARCHAR;
BEGIN
  -- Service branch drives the physical device; fall back to the sale branch.
  SELECT customer_id, COALESCE(service_branch_id, branch_id), device_model_id, device_model_name
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

COMMIT;
