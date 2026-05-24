-- Migration 115: Add sale_type to contracts
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS sale_type VARCHAR(30) NOT NULL DEFAULT 'marketing'
    CHECK (sale_type IN ('marketing', 'tradein', 'app', 'referral', 'direct'));
