BEGIN;

-- Existing duplicate historical visits are preserved for administrative review.
-- This lookup index supports both the application pre-check and the trigger below.
CREATE INDEX IF NOT EXISTS idx_field_visits_team_slot_lookup
  ON public.field_visits (
    branch_id,
    scheduled_date,
    (substring(COALESCE(scheduled_time, '') from 1 for 5)),
    ((team_snapshot->>'teamKey'))
  )
  WHERE status <> 'cancelled';

CREATE OR REPLACE FUNCTION public.enforce_field_visit_team_slot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_team_key text;
  new_slot_time text;
  lock_key text;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  new_team_key := NULLIF(NEW.team_snapshot->>'teamKey', '');
  new_slot_time := NULLIF(substring(COALESCE(NEW.scheduled_time, '') from 1 for 5), '');

  -- Rows without a complete schedulable slot (for example legacy synthetic
  -- visits) do not participate in team-slot uniqueness.
  IF NEW.branch_id IS NULL OR NEW.scheduled_date IS NULL
     OR new_team_key IS NULL OR new_slot_time IS NULL THEN
    RETURN NEW;
  END IF;

  lock_key := concat_ws('|', NEW.branch_id::text, NEW.scheduled_date::text, new_team_key, new_slot_time);
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  IF EXISTS (
    SELECT 1
      FROM public.field_visits fv
      LEFT JOIN public.contact_targets ct ON ct.latest_visit_id = fv.id
     WHERE fv.id <> NEW.id
       AND fv.status <> 'cancelled'
       AND fv.branch_id = NEW.branch_id
       AND fv.scheduled_date = NEW.scheduled_date
       AND COALESCE(NULLIF(fv.team_snapshot->>'teamKey', ''), ct.team_key) = new_team_key
       AND substring(COALESCE(fv.scheduled_time, '') from 1 for 5) = new_slot_time
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      CONSTRAINT = 'uq_field_visits_team_slot',
      MESSAGE = 'field visit team slot is already occupied';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_field_visit_team_slot ON public.field_visits;
CREATE TRIGGER trg_enforce_field_visit_team_slot
BEFORE INSERT OR UPDATE OF branch_id, scheduled_date, scheduled_time, team_snapshot, status
ON public.field_visits
FOR EACH ROW
EXECUTE FUNCTION public.enforce_field_visit_team_slot();

COMMIT;
