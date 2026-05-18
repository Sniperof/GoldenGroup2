-- Migration 101: Add installation address fields to contracts
-- Context: The contract form UI captures installation address + GPS but the backend
-- was silently dropping these fields. Every contract needs its own installation
-- address because a client may have multiple devices at different locations.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS installation_geo_unit_id INTEGER REFERENCES geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS installation_address_text TEXT,
  ADD COLUMN IF NOT EXISTS installation_lat          NUMERIC,
  ADD COLUMN IF NOT EXISTS installation_lng          NUMERIC;

CREATE INDEX IF NOT EXISTS idx_contracts_installation_geo
  ON contracts(installation_geo_unit_id);
