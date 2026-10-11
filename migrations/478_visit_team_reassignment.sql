-- 478: Visit team reassignment («الفريق الرديف»)
--
-- The reassigned_* columns on field_visits existed since the initial schema and
-- every reader already resolves the effective team per role
-- (COALESCE(reassigned_X_id, team_snapshot->>'XEmployeeId')), but nothing ever
-- wrote them: the "change team" button was a stub. Decisions (2026-10-11):
--   D1  «الفريق الرديف» = the replacement team now holding the visit; the old
--       one is «الفريق الأصلي (المُستبدَل)».
--   D2  per-role replacement (+ UI shortcut: pick a team of the day); the full
--       effective team is stored in reassigned_team_snapshot; the team keeps a
--       valid shape (standard: supervisor + technician, solo: technician).
--   D3  team_responsible_user_id follows the new responsible role; open
--       scheduled-visit alerts move with it; it must be an active account.
--   D4  append-only history (this file) with a mandatory reason from a managed
--       list; the reassigned_* columns only hold the current state.
--   D5  unfinished linked open_tasks get the new team_snapshot (logged as
--       team_changed by migration 477).
--   D6  replacement people must be free: slot occupancy is checked on the
--       effective PEOPLE, not only on the original team key.
--   D7  the customer is told when the visible supervisor/technician changes.
--   D8  permission field_visits.reassign_team (GLOBAL/BRANCH), not granted to
--       any role by default; only while the visit is `scheduled`.

BEGIN;

-- ── 1) Permission (D8) — defined, granted to nobody ─────────────────────────
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES ('field_visits.reassign_team', 'field_visits', 'visits', 'reassign_team',
        'تغيير فريق الزيارة (الفريق الرديف)', 212, ARRAY['GLOBAL', 'BRANCH']::text[])
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

-- ── 2) Managed reason list (D4) ─────────────────────────────────────────────
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'visit_team_change_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('member_sick',          10, '{"label":"مرض أو غياب أحد أعضاء الفريق"}'),
  ('vehicle_breakdown',    20, '{"label":"عطل في وسيلة النقل"}'),
  ('workload_balance',     30, '{"label":"توزيع ضغط العمل"}'),
  ('skill_required',       40, '{"label":"الزيارة تحتاج خبرة فريق آخر"}'),
  ('customer_request',     50, '{"label":"طلب الزبون"}'),
  ('revert_to_original',   60, '{"label":"إعادة الفريق الأصلي"}'),
  ('other',                99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
   WHERE sl.category = 'visit_team_change_reasons' AND sl.value = v.value
);

-- ── 3) History (D4) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_visit_team_changes (
  id bigserial PRIMARY KEY,
  field_visit_id bigint NOT NULL REFERENCES public.field_visits(id) ON DELETE CASCADE,
  -- Effective team before / after, same shape as team_snapshot.
  from_team jsonb NOT NULL,
  to_team jsonb NOT NULL,
  from_responsible_user_id integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
  to_responsible_user_id integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
  reason_id integer NOT NULL REFERENCES public.system_lists(id),
  note text,
  changed_by integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_visit_team_changes_visit
  ON public.field_visit_team_changes (field_visit_id, changed_at);

COMMENT ON TABLE public.field_visit_team_changes IS
  'Append-only history of visit team reassignments («الفريق الرديف»). '
  'field_visits.reassigned_* hold only the current state.';

CREATE OR REPLACE FUNCTION public.forbid_field_visit_team_change_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'field_visit_team_changes is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_field_visit_team_change_update ON public.field_visit_team_changes;
CREATE TRIGGER trg_forbid_field_visit_team_change_update
  BEFORE UPDATE ON public.field_visit_team_changes
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_field_visit_team_change_update();

-- ── 4) Effective people + slot occupancy (D6) ───────────────────────────────
-- The field crew actually going to a visit (telemarketers do not travel).
CREATE OR REPLACE FUNCTION public.field_visit_member_ids(
  p_team_snapshot jsonb,
  p_reassigned_supervisor_id integer,
  p_reassigned_technician_id integer,
  p_reassigned_trainee_id integer
)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(m) FILTER (WHERE m IS NOT NULL), ARRAY[]::integer[])
    FROM unnest(ARRAY[
      COALESCE(p_reassigned_supervisor_id, public.safe_int(p_team_snapshot->>'supervisorEmployeeId')),
      COALESCE(p_reassigned_technician_id, public.safe_int(p_team_snapshot->>'technicianEmployeeId')),
      COALESCE(p_reassigned_trainee_id, public.safe_int(p_team_snapshot->>'traineeEmployeeId'))
    ]) AS m;
$$;

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
  -- per-role swap keeps the original key (same team, substituted member).
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
    OR NEW.reassigned_supervisor_id IS DISTINCT FROM OLD.reassigned_supervisor_id
    OR NEW.reassigned_technician_id IS DISTINCT FROM OLD.reassigned_technician_id
    OR NEW.reassigned_trainee_id IS DISTINCT FROM OLD.reassigned_trainee_id
    OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
    OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id;

  IF people_changed THEN
    new_members := public.field_visit_member_ids(
      NEW.team_snapshot, NEW.reassigned_supervisor_id,
      NEW.reassigned_technician_id, NEW.reassigned_trainee_id
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
               fv.reassigned_technician_id, fv.reassigned_trainee_id
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

DROP TRIGGER IF EXISTS trg_enforce_field_visit_team_slot ON public.field_visits;
CREATE TRIGGER trg_enforce_field_visit_team_slot
BEFORE INSERT OR UPDATE OF branch_id, scheduled_date, scheduled_time, team_snapshot, status,
  reassigned_supervisor_id, reassigned_technician_id, reassigned_trainee_id, reassigned_team_snapshot
ON public.field_visits
FOR EACH ROW
EXECUTE FUNCTION public.enforce_field_visit_team_slot();

-- ── 5) Customer notification (D7): outbox carries team changes ──────────────
ALTER TABLE public.app_notification_outbox
  DROP CONSTRAINT IF EXISTS app_notification_outbox_entity_type_ck,
  ADD  CONSTRAINT app_notification_outbox_entity_type_ck
    CHECK (entity_type IN ('service_request', 'field_visit', 'complaint_public_update', 'field_visit_team_change'));

-- entity_id = the history row; the consumer decides whether the change is
-- visible to the customer (supervisor/technician) and stays silent otherwise.
CREATE OR REPLACE FUNCTION public.app_notification_outbox_capture_team_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.app_notification_outbox (entity_type, entity_id, from_status, to_status)
  VALUES ('field_visit_team_change', NEW.id, NULL, 'team_changed');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_notification_outbox_visit_team_changes ON public.field_visit_team_changes;
CREATE TRIGGER app_notification_outbox_visit_team_changes
  AFTER INSERT ON public.field_visit_team_changes
  FOR EACH ROW EXECUTE FUNCTION public.app_notification_outbox_capture_team_change();

COMMIT;
