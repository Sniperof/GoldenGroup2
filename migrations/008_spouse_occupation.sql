-- ============================================================
-- Migration 008: Add spouse_occupation column to clients table
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS spouse_occupation VARCHAR(255);
