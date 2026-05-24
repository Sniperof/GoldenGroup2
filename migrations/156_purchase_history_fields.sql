BEGIN;

-- Add old_part_removed tracking to emergency parts
ALTER TABLE visit_task_emergency_parts_used
  ADD COLUMN IF NOT EXISTS old_part_removed BOOLEAN DEFAULT FALSE;

-- Add warranty fields to contracts
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS is_golden_warranty BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS golden_warranty_end_date DATE,
  ADD COLUMN IF NOT EXISTS contract_warranty_end_date DATE;

COMMIT;
