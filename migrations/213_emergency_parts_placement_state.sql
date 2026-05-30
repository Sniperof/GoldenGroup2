-- Migration 213: add explicit placement state to emergency result parts
-- --------------------------------------------------------------------
-- We need to distinguish between:
--   installed       -> the part was actually installed on the device
--   customer_stock  -> the part was delivered to the customer but not installed
--
-- This allows:
--   * device_installed_parts to stay device-centric and only track installed parts
--   * customer stock to include emergency parts that are currently with the customer
-- --------------------------------------------------------------------

ALTER TABLE emergency_result_parts
  ADD COLUMN IF NOT EXISTS placement_state VARCHAR(30) NOT NULL DEFAULT 'installed';

ALTER TABLE emergency_result_parts
  DROP CONSTRAINT IF EXISTS emergency_result_parts_placement_state_check;

ALTER TABLE emergency_result_parts
  ADD CONSTRAINT emergency_result_parts_placement_state_check
  CHECK (placement_state IN ('installed', 'customer_stock'));

CREATE INDEX IF NOT EXISTS idx_erp_placement_state
  ON emergency_result_parts(placement_state);
