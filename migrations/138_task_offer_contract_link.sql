-- Migration 138: Link marketing_visit_task_offers to contracts + enrich contracts with source
--
-- Business context: a single device_demo visit may sell multiple devices.
-- Each accepted offer generates an independent sale_reference_number and can
-- be linked to its own contract. This replaces the scalar contract_id on
-- marketing_visit_tasks (which stays as legacy = first contract).

-- ── 1. Offer → Contract FK ────────────────────────────────────────────────────
ALTER TABLE marketing_visit_task_offers
  ADD COLUMN IF NOT EXISTS contract_id INTEGER
    REFERENCES contracts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mvto_contract_id
  ON marketing_visit_task_offers(contract_id)
  WHERE contract_id IS NOT NULL;

-- ── 2. Contract ← Offer / Task back-reference ─────────────────────────────────
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS source_open_task_id  INTEGER
    REFERENCES open_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_task_offer_id BIGINT
    REFERENCES marketing_visit_task_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_reference_number VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_contracts_source_open_task
  ON contracts(source_open_task_id)
  WHERE source_open_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_sale_ref
  ON contracts(sale_reference_number)
  WHERE sale_reference_number IS NOT NULL;
