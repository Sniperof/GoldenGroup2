-- Trigger: keep installed_devices in sync when contracts is updated.
-- During Phase B transition (contracts still written to, installed_devices is the read source).
-- Phase C will remove the contracts columns and this trigger becomes redundant.

CREATE OR REPLACE FUNCTION sync_installed_device_from_contract()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE installed_devices SET
    serial_number              = NEW.serial_number,
    status                     = COALESCE(NEW.device_status, status),
    installation_geo_unit_id   = NEW.installation_geo_unit_id,
    installation_address_text  = NEW.installation_address_text,
    installation_lat           = NEW.installation_lat,
    installation_lng           = NEW.installation_lng,
    delivery_date              = CASE WHEN NEW.delivery_date IS NOT NULL
                                      THEN NEW.delivery_date::DATE ELSE delivery_date END,
    installation_date          = CASE WHEN NEW.installation_date IS NOT NULL
                                      THEN NEW.installation_date::DATE ELSE installation_date END,
    is_golden_warranty         = NEW.is_golden_warranty,
    golden_warranty_end_date   = NEW.golden_warranty_end_date,
    contract_warranty_end_date = NEW.contract_warranty_end_date,
    warranty_months            = NEW.warranty_months,
    warranty_visits            = NEW.warranty_visits
  WHERE contract_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_installed_device ON contracts;
CREATE TRIGGER trg_sync_installed_device
  AFTER UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION sync_installed_device_from_contract();
