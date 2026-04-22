-- ============================================================
-- Migration 011: Add contract data fields to clients table
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS national_id VARCHAR(12);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS referral_notes TEXT;
