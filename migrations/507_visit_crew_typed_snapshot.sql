-- ============================================================
-- 507_visit_crew_typed_snapshot.sql
-- ============================================================
-- DEC-026 + DEC-020 (2026-11-24): a visit crew of any team type.
--
-- Since DEC-026 the team snapshot of a visit carries the typed team:
-- teamType, leadEmployeeId, members by slot and fieldEmployeeIds (everyone
-- who goes on the visit). A replacement crew is stored whole in
-- reassigned_team_snapshot, which becomes the reference; the three legacy
-- reassigned_* columns stay filled for the standard and emergency types so
-- their ~27 readers are unchanged.
--
-- field_visit_member_ids() only saw supervisor / technician / trainee, so a
-- driver or a second field slot of a custom type escaped the "already on
-- another visit at this time" check and the employee crew log. A 5-argument
-- version reads, in order:
--   1. reassigned_team_snapshot.fieldEmployeeIds (a typed replacement crew);
--   2. team_snapshot.fieldEmployeeIds when no legacy reassignment column is set;
--   3. the legacy per-role resolution (older visits).
-- The 4-argument version stays for compatibility.
-- ============================================================

CREATE OR REPLACE FUNCTION public.json_int_array(p_value jsonb)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(DISTINCT public.safe_int(v.value)) FILTER (WHERE public.safe_int(v.value) > 0), ARRAY[]::integer[])
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::jsonb END
    ) AS v(value);
$$;

CREATE OR REPLACE FUNCTION public.field_visit_member_ids(
  p_team_snapshot jsonb,
  p_reassigned_supervisor_id integer,
  p_reassigned_technician_id integer,
  p_reassigned_trainee_id integer,
  p_reassigned_team_snapshot jsonb
)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_reassigned_team_snapshot->'fieldEmployeeIds') = 'array'
      THEN public.json_int_array(p_reassigned_team_snapshot->'fieldEmployeeIds')
    WHEN p_reassigned_supervisor_id IS NULL
     AND p_reassigned_technician_id IS NULL
     AND p_reassigned_trainee_id IS NULL
     AND jsonb_typeof(p_team_snapshot->'fieldEmployeeIds') = 'array'
      THEN public.json_int_array(p_team_snapshot->'fieldEmployeeIds')
    ELSE public.field_visit_member_ids(
      p_team_snapshot, p_reassigned_supervisor_id, p_reassigned_technician_id, p_reassigned_trainee_id)
  END;
$$;

-- Slot enforcement (478): same rules, the crew now read by the 5-arg version.
CREATE OR REPLACE FUNCTION public.enforce_field_visit_team_slot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_team_key text;
  new_slot_time text;
  new_members integer[];
  people_changed boolean;
  lock_key text;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- After a whole-team swap the visit occupies the new team's key; a
  -- per-member swap keeps the original key (same team, substituted member).
  new_team_key := NULLIF(COALESCE(NEW.reassigned_team_snapshot->>'teamKey', NEW.team_snapshot->>'teamKey'), '');
  new_slot_time := NULLIF(substring(COALESCE(NEW.scheduled_time, '') from 1 for 5), '');

  IF NEW.branch_id IS NULL OR NEW.scheduled_date IS NULL OR new_slot_time IS NULL THEN
    RETURN NEW;
  END IF;

  lock_key := concat_ws('|', NEW.branch_id::text, NEW.scheduled_date::text, new_slot_time);
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  IF new_team_key IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.field_visits fv
      LEFT JOIN public.contact_targets ct ON ct.latest_visit_id = fv.id
     WHERE fv.id <> NEW.id
       AND fv.status <> 'cancelled'
       AND fv.branch_id = NEW.branch_id
       AND fv.scheduled_date = NEW.scheduled_date
       AND COALESCE(NULLIF(fv.reassigned_team_snapshot->>'teamKey', ''),
                    NULLIF(fv.team_snapshot->>'teamKey', ''), ct.team_key) = new_team_key
       AND substring(COALESCE(fv.scheduled_time, '') from 1 for 5) = new_slot_time
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      CONSTRAINT = 'uq_field_visits_team_slot',
      MESSAGE = 'field visit team slot is already occupied';
  END IF;

  -- People check only when the crew, the slot or the visit itself is new, so
  -- a status change on a legacy row never trips over historical overlaps.
  people_changed := TG_OP = 'INSERT'
    OR NEW.team_snapshot IS DISTINCT FROM OLD.team_snapshot
    OR NEW.reassigned_team_snapshot IS DISTINCT FROM OLD.reassigned_team_snapshot
    OR NEW.reassigned_supervisor_id IS DISTINCT FROM OLD.reassigned_supervisor_id
    OR NEW.reassigned_technician_id IS DISTINCT FROM OLD.reassigned_technician_id
    OR NEW.reassigned_trainee_id IS DISTINCT FROM OLD.reassigned_trainee_id
    OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
    OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id;

  IF people_changed THEN
    new_members := public.field_visit_member_ids(
      NEW.team_snapshot, NEW.reassigned_supervisor_id,
      NEW.reassigned_technician_id, NEW.reassigned_trainee_id, NEW.reassigned_team_snapshot
    );
    IF cardinality(new_members) > 0 AND EXISTS (
      SELECT 1
        FROM public.field_visits fv
       WHERE fv.id <> NEW.id
         AND fv.status <> 'cancelled'
         AND fv.branch_id = NEW.branch_id
         AND fv.scheduled_date = NEW.scheduled_date
         AND substring(COALESCE(fv.scheduled_time, '') from 1 for 5) = new_slot_time
         AND public.field_visit_member_ids(
               fv.team_snapshot, fv.reassigned_supervisor_id,
               fv.reassigned_technician_id, fv.reassigned_trainee_id, fv.reassigned_team_snapshot
             ) && new_members
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        CONSTRAINT = 'uq_field_visits_team_slot',
        MESSAGE = 'a team member already has another visit in this slot';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Employee crew log (480): typed crew too, and fire on the snapshot.
CREATE OR REPLACE FUNCTION public.log_visit_crew_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old integer[];
  v_new integer[];
  v_member integer;
  v_label text;
BEGIN
  v_old := public.field_visit_member_ids(OLD.team_snapshot, OLD.reassigned_supervisor_id,
                                         OLD.reassigned_technician_id, OLD.reassigned_trainee_id,
                                         OLD.reassigned_team_snapshot);
  v_new := public.field_visit_member_ids(NEW.team_snapshot, NEW.reassigned_supervisor_id,
                                         NEW.reassigned_technician_id, NEW.reassigned_trainee_id,
                                         NEW.reassigned_team_snapshot);
  IF v_old @> v_new AND v_new @> v_old THEN
    RETURN NULL;
  END IF;
  v_label := concat('زيارة #', NEW.id, CASE WHEN NEW.scheduled_date IS NOT NULL
                                              THEN concat(' (', NEW.scheduled_date, ')') END);

  FOREACH v_member IN ARRAY v_new LOOP
    IF NOT v_member = ANY(v_old) AND EXISTS (SELECT 1 FROM public.employees WHERE id = v_member) THEN
      PERFORM public.write_employee_activity(v_member, 'visit_crew_added', NULL, NULL, v_label, NULL, NEW.id);
    END IF;
  END LOOP;
  FOREACH v_member IN ARRAY v_old LOOP
    IF NOT v_member = ANY(v_new) AND EXISTS (SELECT 1 FROM public.employees WHERE id = v_member) THEN
      PERFORM public.write_employee_activity(v_member, 'visit_crew_removed', NULL, v_label, NULL, NULL, NEW.id);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_visit_crew_changes ON public.field_visits;
CREATE TRIGGER trg_log_visit_crew_changes
  AFTER UPDATE OF team_snapshot, reassigned_supervisor_id, reassigned_technician_id, reassigned_trainee_id,
    reassigned_team_snapshot
  ON public.field_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.log_visit_crew_changes();
