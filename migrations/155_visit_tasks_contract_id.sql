BEGIN;

-- Add contract_id to visit_tasks (FK to contracts, nullable)
ALTER TABLE visit_tasks
  ADD COLUMN IF NOT EXISTS contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL;

-- Audit snapshot (point-in-time copy, not the UI source)
ALTER TABLE visit_tasks
  ADD COLUMN IF NOT EXISTS contract_snapshot JSONB;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_visit_tasks_contract_id
  ON visit_tasks(contract_id);

COMMIT;
