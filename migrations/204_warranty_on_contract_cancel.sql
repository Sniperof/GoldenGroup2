-- Migration 204: Warranty cascade on contract cancellation per DEC-CT-05
-- ----------------------------------------------------------------------
-- Reference: docs/constitution/contracts/08-resolved-decisions.md (DEC-CT-05)
--
-- Rule from the constitution:
--   "If a contract is cancelled before its receivables are settled AND
--    the device is 'active', the contract warranty is cancelled."
--
-- Implementation:
--   AFTER UPDATE OF status ON contracts:
--     IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
--       find the installed_devices row for this contract;
--       if device.status = 'active' AND any installment has remaining_balance > 0,
--         cancel the contract warranty with reason='contract_cancelled'.
-- ----------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION trg_warranty_on_contract_cancel()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_device_id   INTEGER;
  v_dev_status  VARCHAR(50);
  v_unsettled   INTEGER;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    SELECT id, status INTO v_device_id, v_dev_status
      FROM installed_devices
      WHERE contract_id = NEW.id
      LIMIT 1;

    IF v_device_id IS NULL OR v_dev_status <> 'active' THEN
      RETURN NULL;
    END IF;

    SELECT COUNT(*) INTO v_unsettled
      FROM contract_installments
      WHERE contract_id = NEW.id
        AND remaining_balance > 0;

    IF v_unsettled = 0 THEN
      -- Receivables fully settled — leave the warranty alone.
      RETURN NULL;
    END IF;

    UPDATE device_warranties
       SET status              = 'cancelled',
           cancellation_reason = 'contract_cancelled',
           cancelled_at        = NOW()
     WHERE device_id = v_device_id
       AND warranty_type = 'contract'
       AND status IN ('pending', 'active');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_contracts_warranty_on_cancel ON contracts;
CREATE TRIGGER trg_contracts_warranty_on_cancel
  AFTER UPDATE OF status ON contracts
  FOR EACH ROW EXECUTE FUNCTION trg_warranty_on_contract_cancel();

COMMIT;
