-- ============================================================
-- Migration 009: Add data_quality column to clients table
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS data_quality VARCHAR(50);
