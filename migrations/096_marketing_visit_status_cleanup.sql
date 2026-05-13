-- Align marketing_visits.status with the visit lifecycle contract.
-- Visit-level reschedule is now stored as 'rescheduled'.

DO $$
DECLARE
  existing_constraint_name text;
BEGIN
  SELECT con.conname
    INTO existing_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'marketing_visits'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%';

  IF existing_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE marketing_visits DROP CONSTRAINT %I',
      existing_constraint_name
    );
  END IF;
END $$;

ALTER TABLE marketing_visits
  ADD CONSTRAINT marketing_visits_status_check
  CHECK (
    status IN (
      'scheduled',
      'in_visit',
      'ended',
      'completed',
      'not_completed',
      'cancelled',
      'rescheduled'
    )
  );
