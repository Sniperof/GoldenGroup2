-- Migration 095: expand employee status options for staging
--
-- Preserves existing active / vacation values, remaps legacy leave rows to
-- vacation and inactive rows to terminated, and updates the status check
-- constraint to accept the new set.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname
    INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'employees'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status IN (%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE employees DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

UPDATE employees
   SET status = 'vacation'
 WHERE status = 'leave';

UPDATE employees
   SET status = 'terminated'
 WHERE status = 'inactive';

ALTER TABLE employees
  ADD CONSTRAINT employees_status_check
  CHECK (status IN ('active', 'vacation', 'suspended', 'terminated'));
