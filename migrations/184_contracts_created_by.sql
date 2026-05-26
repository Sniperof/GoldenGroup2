-- 184_contracts_created_by.sql
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES hr_users(id) ON DELETE SET NULL;
