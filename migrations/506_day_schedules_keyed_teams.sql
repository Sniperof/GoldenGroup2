-- ============================================================
-- 506_day_schedules_keyed_teams.sql
-- ============================================================
-- DEC-026 phase 2: day_schedules stores typed, explicitly keyed teams.
--
--   before: teams = [{supervisor, technician, trainee, telemarketers}],
--           solos = [{technician, trainee, telemarketers}]
--   after:  teams = [{key, teamType, members: {<slot_key>: [employee ids]}}],
--           solos = []
--
-- Every existing team keeps the key it already has (teams[i] -> 'team_i',
-- solos[i] -> 'solo_i'), so route_assignments, telemarketing_task_lists
-- (including its id), contact targets, open_tasks.assigned_team_key and every
-- other stored key keep pointing at the same team. A legacy slot with no lead
-- was a team cleared in place and is dropped. The trainee position was never
-- used (0 occurrences) and has no slot in the seeded types.
--
-- The application reads both shapes (services/daySchedule.ts), so this data
-- conversion can run before or after the deploy. Requires 505 (team types).
--
-- task_team_label() (477) now finds the team by key in either shape.
-- ============================================================

-- ── 1) task_team_label: key lookup, both shapes ────────────────────────────
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
  v_member record;
BEGIN
  IF p_snapshot IS NOT NULL AND jsonb_typeof(p_snapshot) = 'object' THEN
    v_supervisor := public.safe_int(p_snapshot->>'supervisorEmployeeId');
    v_technician := public.safe_int(p_snapshot->>'technicianEmployeeId');
    v_trainee := public.safe_int(p_snapshot->>'traineeEmployeeId');
    p_team_key := COALESCE(p_team_key, p_snapshot->>'teamKey');
  END IF;

  IF v_supervisor IS NULL AND v_technician IS NULL AND p_team_key IS NOT NULL AND p_for_date IS NOT NULL THEN
    -- New shape: the team carries its key.
    SELECT team INTO v_slot
      FROM public.day_schedules ds
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ds.teams) = 'array' THEN ds.teams ELSE '[]'::jsonb END
      ) AS team
     WHERE ds.date = p_for_date::text
       AND team->>'key' = p_team_key
     LIMIT 1;

    IF v_slot IS NOT NULL THEN
      -- Lead and field members, labelled by their slot (مشرف / فني / ...).
      FOR v_member IN
        SELECT s.label, public.safe_int(m.value) AS employee_id
          FROM public.team_types tt
          JOIN public.team_type_slots s ON s.team_type_id = tt.id
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(v_slot->'members'->s.slot_key) = 'array'
                 THEN v_slot->'members'->s.slot_key ELSE '[]'::jsonb END
          ) AS m(value)
         WHERE tt.key = v_slot->>'teamType'
           AND s.slot_function IN ('lead', 'field')
         ORDER BY CASE s.slot_function WHEN 'lead' THEN 0 ELSE 1 END, s.sort_order, s.id
      LOOP
        CONTINUE WHEN v_member.employee_id IS NULL;
        SELECT name INTO v_name FROM public.employees WHERE id = v_member.employee_id;
        v_parts := v_parts || (v_member.label || ': ' || COALESCE(v_name, '#' || v_member.employee_id));
      END LOOP;
      IF cardinality(v_parts) > 0 THEN
        RETURN array_to_string(v_parts, ' · ');
      END IF;
      RETURN p_team_key;
    END IF;

    -- Legacy shape: positional key.
    v_kind := substring(p_team_key FROM '^(team|solo)_[0-9]+$');
    v_index := public.safe_int(substring(p_team_key FROM '^(?:team|solo)_([0-9]+)$'));
    IF v_kind IS NOT NULL AND v_index IS NOT NULL THEN
      SELECT CASE WHEN v_kind = 'team' THEN ds.teams -> v_index ELSE ds.solos -> v_index END
        INTO v_slot
        FROM public.day_schedules ds
       WHERE ds.date = p_for_date::text
       LIMIT 1;
      IF v_slot IS NOT NULL AND jsonb_typeof(v_slot) = 'object' AND NOT (v_slot ? 'key') THEN
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

-- ── 2) Convert stored rows to the keyed shape ───────────────────────────────
-- Helper: a legacy id or id list as a clean jsonb int array.
CREATE OR REPLACE FUNCTION pg_temp.legacy_id_array(p_value jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT public.safe_int(v.value)) FILTER (WHERE public.safe_int(v.value) > 0), '[]'::jsonb)
  FROM jsonb_array_elements_text(
    CASE jsonb_typeof(p_value)
      WHEN 'array' THEN p_value
      WHEN 'null' THEN '[]'::jsonb
      ELSE jsonb_build_array(p_value)
    END
  ) AS v(value);
$$;

CREATE OR REPLACE FUNCTION pg_temp.legacy_members(p_slot jsonb, p_lead text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'supervisor',    CASE WHEN p_lead = 'supervisor' THEN pg_temp.legacy_id_array(p_slot->'supervisor') END,
    'technician',    NULLIF(pg_temp.legacy_id_array(p_slot->'technician'), '[]'::jsonb),
    'telemarketers', NULLIF(pg_temp.legacy_id_array(p_slot->'telemarketers'), '[]'::jsonb)
  ));
$$;

UPDATE public.day_schedules ds
SET teams = converted.teams,
    solos = '[]'::jsonb
FROM (
  SELECT d.date,
         COALESCE((
           SELECT jsonb_agg(x.team ORDER BY x.ord)
           FROM (
             SELECT t.ord, jsonb_build_object(
                      'key', 'team_' || (t.ord - 1),
                      'teamType', 'standard',
                      'members', pg_temp.legacy_members(t.slot, 'supervisor')) AS team
             FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(d.teams) = 'array' THEN d.teams ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS t(slot, ord)
             WHERE public.safe_int(t.slot->>'supervisor') > 0
             UNION ALL
             SELECT 100000 + s.ord, jsonb_build_object(
                      'key', 'solo_' || (s.ord - 1),
                      'teamType', 'emergency',
                      'members', pg_temp.legacy_members(s.slot, 'technician')) AS team
             FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(d.solos) = 'array' THEN d.solos ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS s(slot, ord)
             WHERE public.safe_int(s.slot->>'technician') > 0
           ) x
         ), '[]'::jsonb) AS teams
  FROM public.day_schedules d
  -- Only legacy rows: no team already carries a key.
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(d.teams) = 'array' THEN d.teams ELSE '[]'::jsonb END
    ) AS k(team)
    WHERE k.team ? 'key'
  )
) AS converted
WHERE ds.date = converted.date;
