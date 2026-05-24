-- Migration 111: Add target_candidates to referral_sheets
-- Stores the number of names the field team commits to entering later,
-- distinct from total_candidates which counts actual entries.

ALTER TABLE referral_sheets
  ADD COLUMN IF NOT EXISTS target_candidates INTEGER NOT NULL DEFAULT 0;
