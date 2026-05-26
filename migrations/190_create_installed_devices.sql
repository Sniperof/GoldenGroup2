-- ============================================================
-- Migration 190: Create installed_devices table
-- Phase A of the contract/device separation roadmap.
-- Each installed device tracks the physical lifecycle of a unit
-- independently from the financial contract.
-- ============================================================

CREATE TABLE IF NOT EXISTS installed_devices (
  id                        SERIAL PRIMARY KEY,

  -- Origin (financial link — immutable after creation)
  contract_id               INTEGER NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  customer_id               INTEGER NOT NULL REFERENCES clients(id)   ON DELETE RESTRICT,
  branch_id                 INTEGER          REFERENCES branches(id)  ON DELETE SET NULL,

  -- Device identity
  device_model_id           INTEGER          REFERENCES device_models(id) ON DELETE SET NULL,
  device_model_name         VARCHAR(255),
  serial_number             VARCHAR(255),

  -- Physical lifecycle status
  -- pending_delivery → delivered → installed → active
  status                    VARCHAR(50) NOT NULL DEFAULT 'pending_delivery'
                              CHECK (status IN ('pending_delivery','delivered','installed','active','decommissioned')),

  -- Physical location (can change over time — e.g. device moved)
  installation_geo_unit_id  INTEGER          REFERENCES geo_units(id) ON DELETE SET NULL,
  installation_address_text TEXT,
  installation_lat          NUMERIC(12, 8),
  installation_lng          NUMERIC(12, 8),

  -- Operational dates (facts about the device, not the contract)
  delivery_date             DATE,
  installation_date         DATE,

  -- Warranties
  is_golden_warranty        BOOLEAN NOT NULL DEFAULT FALSE,
  golden_warranty_end_date  DATE,
  contract_warranty_end_date DATE,
  warranty_months           INTEGER,
  warranty_visits           INTEGER,

  -- Audit
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One device per sale contract (1:1 initially)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_installed_devices_contract
  ON installed_devices(contract_id);

CREATE INDEX IF NOT EXISTS idx_installed_devices_customer
  ON installed_devices(customer_id);

CREATE INDEX IF NOT EXISTS idx_installed_devices_branch
  ON installed_devices(branch_id);

CREATE INDEX IF NOT EXISTS idx_installed_devices_model
  ON installed_devices(device_model_id);

CREATE INDEX IF NOT EXISTS idx_installed_devices_status
  ON installed_devices(status);

-- ── Backfill from contracts ──────────────────────────────────
-- Populate one installed_device row per existing contract,
-- copying all device-physical fields.
INSERT INTO installed_devices (
  contract_id,
  customer_id,
  branch_id,
  device_model_id,
  device_model_name,
  serial_number,
  status,
  installation_geo_unit_id,
  installation_address_text,
  installation_lat,
  installation_lng,
  delivery_date,
  installation_date,
  is_golden_warranty,
  golden_warranty_end_date,
  contract_warranty_end_date,
  warranty_months,
  warranty_visits,
  created_at
)
SELECT
  c.id                          AS contract_id,
  c.customer_id                 AS customer_id,
  c.branch_id                   AS branch_id,
  c.device_model_id             AS device_model_id,
  c.device_model_name           AS device_model_name,
  c.serial_number               AS serial_number,
  COALESCE(c.device_status, 'pending_delivery') AS status,
  c.installation_geo_unit_id    AS installation_geo_unit_id,
  c.installation_address_text   AS installation_address_text,
  c.installation_lat            AS installation_lat,
  c.installation_lng            AS installation_lng,
  CASE WHEN c.delivery_date IS NOT NULL
       THEN c.delivery_date::DATE ELSE NULL END AS delivery_date,
  CASE WHEN c.installation_date IS NOT NULL
       THEN c.installation_date::DATE ELSE NULL END AS installation_date,
  c.is_golden_warranty          AS is_golden_warranty,
  c.golden_warranty_end_date    AS golden_warranty_end_date,
  c.contract_warranty_end_date  AS contract_warranty_end_date,
  c.warranty_months             AS warranty_months,
  c.warranty_visits             AS warranty_visits,
  c.created_at                  AS created_at
FROM contracts c
ON CONFLICT (contract_id) DO NOTHING;

-- ── Add installed_device_id back-reference on contracts ──────
-- Allows fast lookup: given a contract → its installed device.
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS installed_device_id INTEGER
    REFERENCES installed_devices(id) ON DELETE SET NULL;

UPDATE contracts c
SET installed_device_id = d.id
FROM installed_devices d
WHERE d.contract_id = c.id;

-- ── updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_installed_devices_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_installed_devices_updated_at ON installed_devices;
CREATE TRIGGER trg_installed_devices_updated_at
  BEFORE UPDATE ON installed_devices
  FOR EACH ROW EXECUTE FUNCTION set_installed_devices_updated_at();
