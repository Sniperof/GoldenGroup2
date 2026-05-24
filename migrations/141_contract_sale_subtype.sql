-- Migration 141: Add sale_subtype column to contracts
--

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS sale_subtype VARCHAR(30) DEFAULT 'definitive'
  CONSTRAINT contracts_sale_subtype_check CHECK (sale_subtype IN ('definitive', 'temporary', 'free'));
