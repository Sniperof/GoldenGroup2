-- 183_contracts_add_code.sql
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS code VARCHAR(100);
