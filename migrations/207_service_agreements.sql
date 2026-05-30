-- Migration 207: service_agreements per DEC-CT-02
-- ----------------------------------------------------------------------
-- Reference: docs/constitution/contracts/08-resolved-decisions.md (DEC-CT-02)
--
-- Splits the legacy "maintenance_contract" out of the contracts table into
-- a dedicated service_agreements entity. The external device covered by
-- such an agreement is NOT a sale — it's a third-party device we service.
--
-- Steps:
--   1. Create service_agreements.
--   2. Copy existing contracts rows where contract_type='maintenance_contract'
--      into service_agreements (preserving the original contract id as
--      legacy_contract_id for traceability).
--   3. Soft-deactivate the legacy contract rows (status='discarded') so the
--      contracts table no longer mixes the two concepts.
--      We don't DELETE the rows to keep audit / FK references intact.
--   4. Replace the contracts.contract_type CHECK to drop 'maintenance_contract'.
--
-- Future cleanup: a follow-up migration can drop contracts.contract_type
-- entirely once all consumers stop reading it.
-- ----------------------------------------------------------------------

BEGIN;

-- 1. Service agreements table.
CREATE TABLE IF NOT EXISTS service_agreements (
  id                          SERIAL PRIMARY KEY,
  agreement_number            VARCHAR(50) UNIQUE,
  customer_id                 INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  customer_name               VARCHAR(255) NOT NULL,
  branch_id                   INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  agreement_date              DATE NOT NULL,

  -- The external device (not in installed_devices: it's not our sale).
  external_device_model_name  VARCHAR(255),
  external_device_serial      VARCHAR(255),
  external_device_notes       TEXT,

  -- Service scope.
  maintenance_plan            VARCHAR(20),   -- e.g. '3','6','12' months between visits
  visits_count                INTEGER,        -- total visits included in this agreement
  fee_syp                     NUMERIC NOT NULL DEFAULT 0,

  -- Status (DEC-CT-01-ish — adapted for service agreements).
  status                      VARCHAR(20) NOT NULL DEFAULT 'active'
                                CHECK (status IN ('draft', 'active', 'cancelled', 'completed', 'discarded')),

  -- Operational dates.
  start_date                  DATE,
  end_date                    DATE,

  -- Audit & provenance.
  closing_employee_id         INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  created_by                  INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  legacy_contract_id          INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_agreements_customer
  ON service_agreements(customer_id);

CREATE INDEX IF NOT EXISTS idx_service_agreements_branch
  ON service_agreements(branch_id);

CREATE INDEX IF NOT EXISTS idx_service_agreements_status
  ON service_agreements(status);

CREATE INDEX IF NOT EXISTS idx_service_agreements_legacy_contract
  ON service_agreements(legacy_contract_id)
  WHERE legacy_contract_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_service_agreements_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_service_agreements_updated_at ON service_agreements;
CREATE TRIGGER trg_service_agreements_updated_at
  BEFORE UPDATE ON service_agreements
  FOR EACH ROW EXECUTE FUNCTION set_service_agreements_updated_at();

-- 2. Migrate legacy maintenance_contract rows.
INSERT INTO service_agreements (
  agreement_number, customer_id, customer_name, branch_id, agreement_date,
  external_device_model_name, external_device_serial,
  maintenance_plan, fee_syp,
  status,
  closing_employee_id, created_by, legacy_contract_id, notes
)
SELECT
  c.contract_number,
  c.customer_id,
  c.customer_name,
  c.branch_id,
  c.contract_date,
  c.device_model_name,
  -- The legacy serial used to live on contracts before Phase 6 — fetch from
  -- installed_devices when present, else NULL.
  (SELECT d.serial_number FROM installed_devices d WHERE d.contract_id = c.id LIMIT 1),
  c.maintenance_plan,
  COALESCE(c.final_price, 0),
  -- Map legacy contract status into the service-agreement status space.
  CASE
    WHEN c.status = 'cancelled' THEN 'cancelled'
    WHEN c.status = 'completed' THEN 'completed'
    WHEN c.status = 'discarded' THEN 'discarded'
    WHEN c.status = 'draft'     THEN 'draft'
    ELSE 'active'
  END,
  c.closing_employee_id,
  c.created_by,
  c.id,
  'Migrated from contracts(' || c.id || ') by migration 207'
FROM contracts c
WHERE c.contract_type = 'maintenance_contract'
  AND NOT EXISTS (
    SELECT 1 FROM service_agreements sa WHERE sa.legacy_contract_id = c.id
  );

-- 3. Mark the legacy contracts as discarded so the contracts surface no
--    longer mixes maintenance and sale concepts.
UPDATE contracts
   SET status = 'discarded'
 WHERE contract_type = 'maintenance_contract'
   AND status <> 'discarded';

-- 4. Drop 'maintenance_contract' from the contract_type CHECK.
ALTER TABLE contracts
  DROP CONSTRAINT IF EXISTS contracts_contract_type_check;

ALTER TABLE contracts
  ADD CONSTRAINT contracts_contract_type_check
  CHECK (contract_type IN ('sale_contract'));

COMMIT;
