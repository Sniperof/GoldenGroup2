-- Migration 041: Add created_by to clients table
-- Separates "who added" (immutable audit) from "who is assigned" (operational).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES hr_users(id) ON DELETE SET NULL;

-- Backfill: best available approximation for existing rows
UPDATE clients
  SET created_by = assigned_hr_user_id
  WHERE created_by IS NULL AND assigned_hr_user_id IS NOT NULL;
