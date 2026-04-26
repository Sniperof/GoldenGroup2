-- Migration 035: add referral_entity_id to employees
-- Stores the linked entity ID when referrerType is Employee or Client.
-- Idempotent.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS referral_entity_id INTEGER;
