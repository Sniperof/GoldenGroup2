-- Phase 6: drop legacy physical-device columns from contracts.
-- All reads have come from installed_devices since Phase 2B.
-- All writes have gone to installed_devices since Phase 2C.
-- open_tasks.device_id is live since Phase 3.
--
-- maintenance_plan is kept: still used as legacy fallback for old contracts
-- until GAP-079 Phase 3 (decouple field_visits scheduling) is complete.

-- ── Update trigger 191 before dropping its referenced columns ────────────
-- The trigger previously copied physical fields from NEW.* into installed_devices.
-- Phase 2C moved those writes to application code, so the trigger now only
-- needs to create a minimal row and set the back-reference.
CREATE OR REPLACE FUNCTION auto_create_installed_device()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_device_id INTEGER;
BEGIN
  INSERT INTO installed_devices (
    contract_id, customer_id, branch_id,
    device_model_id, device_model_name,
    status
  ) VALUES (
    NEW.id, NEW.customer_id, NEW.branch_id,
    NEW.device_model_id, NEW.device_model_name,
    'pending_delivery'
  )
  RETURNING id INTO v_device_id;

  UPDATE contracts SET installed_device_id = v_device_id WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

-- ── Drop columns ─────────────────────────────────────────────────────────
ALTER TABLE contracts
  DROP COLUMN IF EXISTS serial_number,
  DROP COLUMN IF EXISTS device_status,
  DROP COLUMN IF EXISTS delivery_date,
  DROP COLUMN IF EXISTS installation_date,
  DROP COLUMN IF EXISTS installation_geo_unit_id,
  DROP COLUMN IF EXISTS installation_address_text,
  DROP COLUMN IF EXISTS installation_lat,
  DROP COLUMN IF EXISTS installation_lng,
  DROP COLUMN IF EXISTS is_golden_warranty,
  DROP COLUMN IF EXISTS golden_warranty_end_date,
  DROP COLUMN IF EXISTS contract_warranty_end_date,
  DROP COLUMN IF EXISTS warranty_months,
  DROP COLUMN IF EXISTS warranty_visits;
