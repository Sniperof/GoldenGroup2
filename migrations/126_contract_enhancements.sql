-- 1. Contract line items table
CREATE TABLE IF NOT EXISTS contract_line_items (
  id              SERIAL PRIMARY KEY,
  contract_id     INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  item_type       VARCHAR(50) NOT NULL CHECK (item_type IN ('device', 'accessory', 'service_fee')),
  spare_part_id   INTEGER REFERENCES spare_parts(id) ON DELETE SET NULL,
  description     VARCHAR(500),
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price      NUMERIC NOT NULL CHECK (unit_price >= 0),
  total_price     NUMERIC NOT NULL CHECK (total_price >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_items_contract ON contract_line_items(contract_id);

-- 2. Add discount_id to contracts
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS discount_id INTEGER REFERENCES device_discounts(id) ON DELETE SET NULL;

-- 3. Add sale_source to contracts
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS sale_source VARCHAR(50)
    CHECK (sale_source IN ('device_demo_task', 'app', 'social_media'));

-- 4. Drop old constraints
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_sale_type_check;
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;

-- 5. Migrate existing data BEFORE adding new constraints
UPDATE contracts SET status = 'active' WHERE status IN ('draft', 'completed');
UPDATE contracts SET sale_type = 'direct' WHERE sale_type NOT IN ('tradein', 'retention', 'direct');

-- 6. Add new constraints
ALTER TABLE contracts
  ADD CONSTRAINT contracts_sale_type_check
    CHECK (sale_type IN ('tradein', 'retention', 'direct'));

ALTER TABLE contracts
  ADD CONSTRAINT contracts_status_check
    CHECK (status IN ('active', 'cancelled', 'temporary'));
