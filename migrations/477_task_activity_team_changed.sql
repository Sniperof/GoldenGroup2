-- 477: Log team changes on open_tasks as `team_changed` (extends 475)
--
-- A task's team lives in two places:
--   * assigned_team_key + assigned_for_date: the planning assignment
--     ('team_N' / 'solo_N' = index into day_schedules.teams / .solos of that date);
--   * team_snapshot: the field team frozen when a visit is booked / a team is
--     assigned (supervisorEmployeeId / technicianEmployeeId / traineeEmployeeId).
-- Keys are positional and meaningless to a reader ('team_0'), and the day
-- schedule can be edited later, so the log stores the team as people's names,
-- resolved at the moment of the change. A row is written only when that
-- readable team actually changes (assignment, release, or a different crew),
-- so touching the key and the snapshot in one UPDATE yields a single row and
-- telemarketer-only snapshot edits stay silent.

BEGIN;

-- A malformed id inside a JSON team must never make the task UPDATE fail.
CREATE OR REPLACE FUNCTION public.safe_int(p_value text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_value ~ '^[0-9]{1,9}$' THEN p_value::integer END;
$$;

CREATE OR REPLACE FUNCTION public.task_team_label(
  p_team_key text,
  p_for_date date,
  p_snapshot jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_supervisor integer;
  v_technician integer;
  v_trainee integer;
  v_slot jsonb;
  v_kind text;
  v_index integer;
  v_parts text[] := ARRAY[]::text[];
  v_name text;
BEGIN
  IF p_snapshot IS NOT NULL AND jsonb_typeof(p_snapshot) = 'object' THEN
    v_supervisor := public.safe_int(p_snapshot->>'supervisorEmployeeId');
    v_technician := public.safe_int(p_snapshot->>'technicianEmployeeId');
    v_trainee := public.safe_int(p_snapshot->>'traineeEmployeeId');
    p_team_key := COALESCE(p_team_key, p_snapshot->>'teamKey');
  END IF;

  IF v_supervisor IS NULL AND v_technician IS NULL AND p_team_key IS NOT NULL THEN
    v_kind := substring(p_team_key FROM '^(team|solo)_[0-9]+$');
    v_index := public.safe_int(substring(p_team_key FROM '^(?:team|solo)_([0-9]+)$'));
    IF v_kind IS NOT NULL AND v_index IS NOT NULL AND p_for_date IS NOT NULL THEN
      SELECT CASE WHEN v_kind = 'team' THEN ds.teams -> v_index ELSE ds.solos -> v_index END
        INTO v_slot
        FROM public.day_schedules ds
       WHERE ds.date = p_for_date::text
       LIMIT 1;
      IF v_slot IS NOT NULL AND jsonb_typeof(v_slot) = 'object' THEN
        v_supervisor := public.safe_int(v_slot->>'supervisor');
        v_technician := public.safe_int(v_slot->>'technician');
        v_trainee := public.safe_int(v_slot->>'trainee');
      END IF;
    END IF;
  END IF;

  IF v_supervisor IS NOT NULL THEN
    SELECT name INTO v_name FROM public.employees WHERE id = v_supervisor;
    v_parts := v_parts || ('مشرف: ' || COALESCE(v_name, '#' || v_supervisor));
  END IF;
  IF v_technician IS NOT NULL THEN
    SELECT name INTO v_name FROM public.employees WHERE id = v_technician;
    v_parts := v_parts || ('فني: ' || COALESCE(v_name, '#' || v_technician));
  END IF;
  IF v_trainee IS NOT NULL THEN
    SELECT name INTO v_name FROM public.employees WHERE id = v_trainee;
    v_parts := v_parts || ('متدرب: ' || COALESCE(v_name, '#' || v_trainee));
  END IF;

  IF cardinality(v_parts) > 0 THEN
    RETURN array_to_string(v_parts, ' · ');
  END IF;
  RETURN p_team_key;  -- unresolvable key: keep the raw key rather than nothing
END;
$$;

CREATE OR REPLACE FUNCTION public.log_open_task_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_team text;
  v_new_team text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_task_activity_from_trigger(
      NEW.id, 'created', NULL, NEW.status, NEW.created_by
    );
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.write_task_activity_from_trigger(
      NEW.id, 'status_change', OLD.status, NEW.status
    );
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    PERFORM public.write_task_activity_from_trigger(
      NEW.id, 'priority_changed', OLD.priority, NEW.priority
    );
  END IF;

  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    PERFORM public.write_task_activity_from_trigger(
      NEW.id, 'rescheduled', OLD.due_date::text, NEW.due_date::text
    );
  END IF;

  IF NEW.assigned_team_key IS DISTINCT FROM OLD.assigned_team_key
     OR NEW.team_snapshot IS DISTINCT FROM OLD.team_snapshot THEN
    v_old_team := public.task_team_label(OLD.assigned_team_key, OLD.assigned_for_date, OLD.team_snapshot);
    v_new_team := public.task_team_label(NEW.assigned_team_key, NEW.assigned_for_date, NEW.team_snapshot);
    IF v_old_team IS DISTINCT FROM v_new_team THEN
      PERFORM public.write_task_activity_from_trigger(
        NEW.id, 'team_changed', v_old_team, v_new_team
      );
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_open_task_changes ON public.open_tasks;
CREATE TRIGGER trg_log_open_task_changes
  AFTER UPDATE OF status, priority, due_date, assigned_team_key, team_snapshot ON public.open_tasks
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.priority IS DISTINCT FROM NEW.priority
    OR OLD.due_date IS DISTINCT FROM NEW.due_date
    OR OLD.assigned_team_key IS DISTINCT FROM NEW.assigned_team_key
    OR OLD.team_snapshot IS DISTINCT FROM NEW.team_snapshot
  )
  EXECUTE FUNCTION public.log_open_task_activity();

COMMIT;
