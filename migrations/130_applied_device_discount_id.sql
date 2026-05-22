ALTER TABLE marketing_visit_tasks
  ADD COLUMN IF NOT EXISTS applied_device_discount_id INTEGER REFERENCES device_discounts(id) ON DELETE SET NULL;

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS applied_device_discount_id INTEGER REFERENCES device_discounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mvt_applied_discount ON marketing_visit_tasks(applied_device_discount_id);
CREATE INDEX IF NOT EXISTS idx_contracts_applied_discount ON contracts(applied_device_discount_id);
