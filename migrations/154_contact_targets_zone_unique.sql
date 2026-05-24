BEGIN;

-- 1. Drop old per-day constraint (without zone_id)
ALTER TABLE contact_targets DROP CONSTRAINT IF EXISTS uq_contact_targets_per_day;

-- 2. Add new per-day-per-zone constraint (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_schema = 'public'
       AND table_name = 'contact_targets'
       AND constraint_name = 'uq_contact_targets_per_day_zone'
  ) THEN
    ALTER TABLE contact_targets
      ADD CONSTRAINT uq_contact_targets_per_day_zone
      UNIQUE (branch_id, target_type, target_id, visit_type, source_type, date, zone_id);
  END IF;
END $$;

-- 3. Ensure zone_id is indexed for performance
CREATE INDEX IF NOT EXISTS idx_contact_targets_zone_date
  ON contact_targets(zone_id, date);

COMMIT;
