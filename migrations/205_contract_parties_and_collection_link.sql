-- Migration 205: Parties (DEC-CT-11, 13) + collection task link (DEC-CT-07)
-- ----------------------------------------------------------------------
-- Reference: docs/constitution/contracts/08-resolved-decisions.md
--
-- DEC-CT-11: contracts.sale_owner_id   (the deal originator, distinct from closer)
-- DEC-CT-13: contracts.offer_team_snapshot (JSON frozen at contract creation)
-- DEC-CT-07: open_tasks.installment_id (collection tasks target a specific installment)
-- ----------------------------------------------------------------------

BEGIN;

-- DEC-CT-11
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS sale_owner_id INTEGER
    REFERENCES hr_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_sale_owner
  ON contracts(sale_owner_id)
  WHERE sale_owner_id IS NOT NULL;

-- DEC-CT-13
-- JSONB so we can index members later (e.g. find contracts where a specific
-- user was on the offer team).
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS offer_team_snapshot JSONB;

-- DEC-CT-07
ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS installment_id INTEGER
    REFERENCES contract_installments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_open_tasks_installment
  ON open_tasks(installment_id)
  WHERE installment_id IS NOT NULL;

-- Collection tasks must target an installment. We enforce this with a
-- conditional CHECK so other task families are unaffected.
-- NOT VALID: existing legacy rows are grandfathered; new inserts/updates enforce.
ALTER TABLE open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_collection_requires_installment;

ALTER TABLE open_tasks
  ADD CONSTRAINT open_tasks_collection_requires_installment
  CHECK (
    task_type NOT IN ('installment_collection', 'maintenance_collection')
    OR installment_id IS NOT NULL
  ) NOT VALID;

COMMIT;
