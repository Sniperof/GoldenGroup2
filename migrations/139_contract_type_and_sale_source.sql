-- Migration 139: Add contract_type, alter sale_source constraint, and seed system_lists for contract sale sources
--

-- 1. Add contract_type column with CHECK constraint and DEFAULT value
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS contract_type VARCHAR(30) NOT NULL DEFAULT 'sale_contract'
    CHECK (contract_type IN ('sale_contract', 'maintenance_contract'));

-- 2. Drop the rigid CHECK constraint on sale_source to support dynamic sources from system_lists
ALTER TABLE contracts
  DROP CONSTRAINT IF EXISTS contracts_sale_source_check;

-- 3. Seed system_lists with initial categories for contract_sale_source
INSERT INTO system_lists (category, value, display_order)
VALUES
  ('contract_sale_source', 'تطبيق', 1),
  ('contract_sale_source', 'تواصل اجتماعي', 2),
  ('contract_sale_source', 'مباشر', 3),
  ('contract_sale_source', 'إحالة', 4)
ON CONFLICT (category, value) DO NOTHING;
