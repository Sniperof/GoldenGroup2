-- ============================================================
-- Migration 010: Add gender column to clients table
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS gender VARCHAR(10);
