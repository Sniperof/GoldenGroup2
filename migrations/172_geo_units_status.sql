-- Add status column to geo_units for Active/Inactive control
-- Inactive units are hidden from end-user address selectors but remain
-- visible in admin settings to allow re-activation.

ALTER TABLE geo_units
  ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive'));
