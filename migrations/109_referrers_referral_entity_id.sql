-- Migration 109: normalize job referrers to the shared mediator contract

ALTER TABLE referrers
  ADD COLUMN IF NOT EXISTS referral_entity_id INTEGER;

UPDATE referrers
SET type = 'Client'
WHERE type = 'Customer';

UPDATE referrers
SET referral_entity_id = employee_id
WHERE type = 'Employee'
  AND referral_entity_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'referrers'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'referrers_type_check'
  ) THEN
    ALTER TABLE referrers DROP CONSTRAINT referrers_type_check;
  END IF;
END $$;

ALTER TABLE referrers
  ADD CONSTRAINT referrers_type_check
  CHECK (type IN ('Employee', 'Client', 'Personal', 'Unknown', 'Customer'));