-- 480: Employee activity log + end-of-service date (2026-10-12)
--
-- Before this, only branch transfers and (since 479) status changes were
-- recorded; every other change to an employee or their system account left no
-- trace (constitution employees.md GAP-072). Decisions:
--   D1  one employee_activity_log, written by DATABASE TRIGGERS so no write
--       path can forget it (same approach as the task log, migration 475):
--       creation, every changed field (old → new), status changes (+ reason),
--       branch transfers (+ note), system account (created, role change,
--       activated/deactivated, password changed — as an event, never the
--       value), and visit-crew changes («الفريق الرديف», DEC-020).
--   D2  employees.end_of_service_date: set when the status becomes
--       terminated (effective date, not future), cleared on rehire, which
--       also sets a new start_work_date (both done by the status service).
-- The actor comes from the per-connection app.* settings (475).

BEGIN;

-- ── 1) End-of-service date (D2) ─────────────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS end_of_service_date date;

COMMENT ON COLUMN public.employees.end_of_service_date IS
  'Effective end of the current employment period; set on → terminated, cleared on rehire (DEC-021/480).';

-- ── 2) The log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_activity_log (
  id bigserial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  event_type varchar(40) NOT NULL CHECK (event_type IN (
    'created', 'field_changed', 'status_changed', 'branch_transferred',
    'account_created', 'account_role_changed', 'account_activated',
    'account_deactivated', 'account_password_changed', 'account_linked',
    'account_unlinked', 'visit_crew_added', 'visit_crew_removed'
  )),
  -- field_changed: the employees column; other events: NULL.
  field_key varchar(60),
  -- Human-readable values (names, not ids), resolved when the event happens.
  old_value text,
  new_value text,
  reason text,
  reference_id bigint,
  performed_by integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
  role varchar(50),
  source varchar(20) NOT NULL DEFAULT 'trigger' CHECK (source IN ('trigger', 'backfill')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_activity_log_employee
  ON public.employee_activity_log (employee_id, created_at DESC);

COMMENT ON TABLE public.employee_activity_log IS
  'Append-only timeline of everything that happened to an employee (migration 480).';

CREATE OR REPLACE FUNCTION public.forbid_employee_activity_log_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'employee_activity_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_employee_activity_log_update ON public.employee_activity_log;
CREATE TRIGGER trg_forbid_employee_activity_log_update
  BEFORE UPDATE ON public.employee_activity_log
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_employee_activity_log_update();

CREATE OR REPLACE FUNCTION public.write_employee_activity(
  p_employee_id integer,
  p_event_type text,
  p_field_key text,
  p_old_value text,
  p_new_value text,
  p_reason text DEFAULT NULL,
  p_reference_id bigint DEFAULT NULL,
  p_fallback_actor integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor integer := COALESCE(public.audit_actor_id(), p_fallback_actor);
BEGIN
  INSERT INTO public.employee_activity_log (
    employee_id, event_type, field_key, old_value, new_value,
    reason, reference_id, performed_by, role
  ) VALUES (
    p_employee_id, p_event_type, p_field_key, p_old_value, p_new_value,
    COALESCE(p_reason, public.audit_setting('change_reason')), p_reference_id, v_actor,
    COALESCE(public.audit_setting('actor_role'), CASE WHEN v_actor IS NULL THEN 'system' END)
  );
END;
$$;

-- Readable value of one employees column (names instead of ids).
CREATE OR REPLACE FUNCTION public.employee_field_display(p_key text, p_value jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_text text;
  v_id integer;
BEGIN
  IF p_value IS NULL OR p_value = 'null'::jsonb THEN
    RETURN NULL;
  END IF;
  v_text := CASE WHEN jsonb_typeof(p_value) = 'string' THEN p_value #>> '{}' ELSE p_value::text END;
  v_id := public.safe_int(v_text);

  IF p_key = 'direct_manager_id' AND v_id IS NOT NULL THEN
    SELECT name INTO v_text FROM public.employees WHERE id = v_id;
  ELSIF p_key = 'department_id' AND v_id IS NOT NULL THEN
    SELECT name INTO v_text FROM public.departments WHERE id = v_id;
  ELSIF p_key = 'branch_id' AND v_id IS NOT NULL THEN
    SELECT name INTO v_text FROM public.branches WHERE id = v_id;
  ELSIF p_key LIKE 'residence\_%\_id' AND v_id IS NOT NULL THEN
    SELECT name INTO v_text FROM public.geo_units WHERE id = v_id;
  END IF;
  RETURN v_text;
END;
$$;

-- ── 3) employees: creation + every changed field ────────────────────────────
-- status and branch are logged from their own operations (479 status history,
-- branch transfers) which carry the reason / note; the derived text column
-- `branch` mirrors branch_id.
CREATE OR REPLACE FUNCTION public.log_employee_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_key text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_employee_activity(NEW.id, 'created', NULL, NULL, NEW.name);
    RETURN NULL;
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    CONTINUE WHEN v_key IN ('id', 'created_at', 'status', 'branch_id', 'branch');
    IF v_old -> v_key IS DISTINCT FROM v_new -> v_key THEN
      IF v_key IN ('contacts', 'avatar', 'job_skills', 'foreign_languages') THEN
        -- Structured/binary values: the event, not a raw dump.
        PERFORM public.write_employee_activity(NEW.id, 'field_changed', v_key, NULL, NULL);
      ELSE
        PERFORM public.write_employee_activity(
          NEW.id, 'field_changed', v_key,
          public.employee_field_display(v_key, v_old -> v_key),
          public.employee_field_display(v_key, v_new -> v_key)
        );
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_employee_changes ON public.employees;
CREATE TRIGGER trg_log_employee_changes
  AFTER INSERT OR UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.log_employee_changes();

-- ── 4) Status changes and branch transfers (from their own tables) ──────────
CREATE OR REPLACE FUNCTION public.log_employee_status_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_reason text;
BEGIN
  SELECT COALESCE(metadata->>'label', value) INTO v_reason FROM public.system_lists WHERE id = NEW.reason_id;
  PERFORM public.write_employee_activity(
    NEW.employee_id, 'status_changed', NULL, NEW.from_status, NEW.to_status,
    concat_ws(' — ', v_reason, NEW.note), NEW.id, NEW.changed_by
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_employee_status_change ON public.employee_status_changes;
CREATE TRIGGER trg_log_employee_status_change
  AFTER INSERT ON public.employee_status_changes
  FOR EACH ROW
  EXECUTE FUNCTION public.log_employee_status_change();

CREATE OR REPLACE FUNCTION public.log_employee_branch_transfer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.write_employee_activity(
    NEW.employee_id, 'branch_transferred', NULL,
    (SELECT name FROM public.branches WHERE id = NEW.from_branch_id),
    (SELECT name FROM public.branches WHERE id = NEW.to_branch_id),
    NEW.note, NEW.id, NEW.transferred_by
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_employee_branch_transfer ON public.employee_branch_transfers;
CREATE TRIGGER trg_log_employee_branch_transfer
  AFTER INSERT ON public.employee_branch_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.log_employee_branch_transfer();

-- ── 5) System account ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_employee_account_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_role text;
  v_new_role text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.employee_id IS NOT NULL THEN
      SELECT display_name INTO v_new_role FROM public.roles WHERE id = NEW.role_id;
      PERFORM public.write_employee_activity(
        NEW.employee_id, 'account_created', NULL, NULL,
        concat_ws(' · ', NEW.username, v_new_role), NULL, NEW.id
      );
    END IF;
    RETURN NULL;
  END IF;

  -- Linking / unlinking an account to an employee record.
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    IF OLD.employee_id IS NOT NULL THEN
      PERFORM public.write_employee_activity(OLD.employee_id, 'account_unlinked', NULL, NEW.username, NULL, NULL, NEW.id);
    END IF;
    IF NEW.employee_id IS NOT NULL THEN
      PERFORM public.write_employee_activity(NEW.employee_id, 'account_linked', NULL, NULL, NEW.username, NULL, NEW.id);
    END IF;
  END IF;

  IF NEW.employee_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    SELECT display_name INTO v_old_role FROM public.roles WHERE id = OLD.role_id;
    SELECT display_name INTO v_new_role FROM public.roles WHERE id = NEW.role_id;
    PERFORM public.write_employee_activity(NEW.employee_id, 'account_role_changed', NULL, v_old_role, v_new_role, NULL, NEW.id);
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    PERFORM public.write_employee_activity(
      NEW.employee_id,
      CASE WHEN NEW.is_active THEN 'account_activated' ELSE 'account_deactivated' END,
      NULL, NULL, NEW.username, NULL, NEW.id
    );
  END IF;

  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    PERFORM public.write_employee_activity(NEW.employee_id, 'account_password_changed', NULL, NULL, NULL, NULL, NEW.id);
  END IF;

  IF NEW.username IS DISTINCT FROM OLD.username THEN
    PERFORM public.write_employee_activity(NEW.employee_id, 'field_changed', 'username', OLD.username, NEW.username, NULL, NEW.id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_employee_account_changes ON public.hr_users;
CREATE TRIGGER trg_log_employee_account_changes
  AFTER INSERT OR UPDATE OF employee_id, role_id, is_active, password_hash, username ON public.hr_users
  FOR EACH ROW
  EXECUTE FUNCTION public.log_employee_account_changes();

-- ── 6) Visit crew changes («الفريق الرديف», DEC-020) ────────────────────────
-- Booking a visit is ordinary work, not an event on the employee; only a
-- change of the crew of an existing visit is logged.
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
                                         OLD.reassigned_technician_id, OLD.reassigned_trainee_id);
  v_new := public.field_visit_member_ids(NEW.team_snapshot, NEW.reassigned_supervisor_id,
                                         NEW.reassigned_technician_id, NEW.reassigned_trainee_id);
  IF v_old = v_new THEN
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
  AFTER UPDATE OF team_snapshot, reassigned_supervisor_id, reassigned_technician_id, reassigned_trainee_id
  ON public.field_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.log_visit_crew_changes();

-- ── 7) Backfill what is already known ───────────────────────────────────────
-- Creation (dated by employees.created_at), past status changes and transfers.
INSERT INTO public.employee_activity_log (employee_id, event_type, new_value, source, role, created_at)
SELECT e.id, 'created', e.name, 'backfill', 'backfill', COALESCE(e.created_at, now())
  FROM public.employees e
 WHERE NOT EXISTS (
   SELECT 1 FROM public.employee_activity_log l WHERE l.employee_id = e.id AND l.event_type = 'created'
 );

INSERT INTO public.employee_activity_log (
  employee_id, event_type, old_value, new_value, reason, reference_id, performed_by, source, role, created_at
)
SELECT c.employee_id, 'status_changed', c.from_status, c.to_status,
       concat_ws(' — ', COALESCE(sl.metadata->>'label', sl.value), c.note),
       c.id, c.changed_by, 'backfill', 'backfill', c.changed_at
  FROM public.employee_status_changes c
  LEFT JOIN public.system_lists sl ON sl.id = c.reason_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.employee_activity_log l
    WHERE l.event_type = 'status_changed' AND l.reference_id = c.id
 );

INSERT INTO public.employee_activity_log (
  employee_id, event_type, old_value, new_value, reason, reference_id, performed_by, source, role, created_at
)
SELECT t.employee_id, 'branch_transferred', fb.name, tb.name, t.note, t.id, t.transferred_by,
       'backfill', 'backfill', t.created_at
  FROM public.employee_branch_transfers t
  LEFT JOIN public.branches fb ON fb.id = t.from_branch_id
  LEFT JOIN public.branches tb ON tb.id = t.to_branch_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.employee_activity_log l
    WHERE l.event_type = 'branch_transferred' AND l.reference_id = t.id
 );

COMMIT;
