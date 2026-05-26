-- Trigger: auto-create an installed_devices row on every new sale_contract INSERT
-- and write the back-reference installed_device_id onto contracts.

CREATE OR REPLACE FUNCTION auto_create_installed_device()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
  ) VALUES (
    NEW.id, NEW.customer_id, NEW.branch_id,
    NEW.device_model_id, NEW.device_model_name, NEW.serial_number,
    COALESCE(NEW.device_status, 'pending_delivery'),
    NEW.installation_geo_unit_id, NEW.installation_address_text,
    NEW.installation_lat, NEW.installation_lng,
    CASE WHEN NEW.delivery_date IS NOT NULL THEN NEW.delivery_date::DATE ELSE NULL END,
    CASE WHEN NEW.installation_date IS NOT NULL THEN NEW.installation_date::DATE ELSE NULL END,
    NEW.is_golden_warranty, NEW.golden_warranty_end_date,
    NEW.contract_warranty_end_date, NEW.warranty_months, NEW.warranty_visits
  )
  RETURNING id INTO v_device_id;

  UPDATE contracts SET installed_device_id = v_device_id WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_installed_device ON contracts;
CREATE TRIGGER trg_auto_create_installed_device
  AFTER INSERT ON contracts
  FOR EACH ROW
  WHEN (NEW.contract_type = 'sale_contract')
  EXECUTE FUNCTION auto_create_installed_device();
