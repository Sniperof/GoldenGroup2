-- 475: Database-owned task activity log + append-only visit task result revisions
--
-- Problem (audit 2026-10-11): task_activity_log was written by hand at ~40 of
-- the ~88 sites that mutate open_tasks. Completion through 10 of the 15 visit
-- result handlers, visit start/end/cancel, booking, pull/undo-pull, client
-- delete, contract cancel and every task creation left no row (54 of 63
-- completed tasks in dev had no completion row). Separately, re-submitting a
-- visit task result overwrites the previous one in place (ON CONFLICT DO
-- UPDATE), so the original entry is lost.
--
-- Design:
--   1) An AFTER trigger on open_tasks writes `created`, `status_change`,
--      `priority_changed` and `rescheduled` (due_date) rows itself, with the
--      real previous value. The actor comes from per-connection settings the
--      API sets (app.actor_id / app.actor_role, see packages/api/db.ts); with
--      no actor the row is attributed to role 'system'.
--   2) Hand-written inserts of those same events keep working: a BEFORE INSERT
--      trigger on task_activity_log merges them into the trigger row of the
--      same transaction (adding reason / reference_id), in either order, so no
--      duplicates and the previous value is always the real one.
--   3) Optional per-transaction context: app.change_context, app.reference_id,
--      app.change_reason (e.g. 'visit_result' / 'result_edit').
--   4) visit_task_result_revisions keeps every recorded version of a visit
--      task result (revision 1 = the original entry). A deferred trigger on
--      visit_task_results snapshots the final state of the result and all of
--      its detail rows at commit, and writes `result_recorded` /
--      `result_edited` to the task log. Existing results are seeded as
--      revision 1.

BEGIN;

-- ── 1) task_activity_log: new columns + event types ─────────────────────────
ALTER TABLE public.task_activity_log
  ADD COLUMN IF NOT EXISTS tx_id bigint,
  ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS context varchar(50),
  -- true once a hand-written row has been merged into this trigger row
  ADD COLUMN IF NOT EXISTS app_merged boolean NOT NULL DEFAULT false;

ALTER TABLE public.task_activity_log
  DROP CONSTRAINT IF EXISTS task_activity_log_source_check;
ALTER TABLE public.task_activity_log
  ADD CONSTRAINT task_activity_log_source_check
  CHECK (source IN ('app', 'trigger', 'backfill'));

ALTER TABLE public.task_activity_log
  DROP CONSTRAINT IF EXISTS task_activity_log_event_type_check;
ALTER TABLE public.task_activity_log
  ADD CONSTRAINT task_activity_log_event_type_check
  CHECK (event_type IN (
    'status_change', 'note_added', 'rescheduled', 'assigned', 'reassigned',
    'call_made', 'priority_changed', 'team_assigned', 'team_changed',
    'lifecycle_skip', 'created', 'result_recorded', 'result_edited'
  ));

CREATE INDEX IF NOT EXISTS idx_task_activity_log_task_tx
  ON public.task_activity_log (task_id, tx_id)
  WHERE tx_id IS NOT NULL;

-- ── 2) Audit settings helpers ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.audit_setting(p_name text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.' || p_name, true), '');
$$;

CREATE OR REPLACE FUNCTION public.audit_actor_id()
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_raw text := public.audit_setting('actor_id');
BEGIN
  IF v_raw IS NULL OR v_raw !~ '^[0-9]+$' THEN
    RETURN NULL;
  END IF;
  RETURN v_raw::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_reference_id()
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_raw text := public.audit_setting('reference_id');
BEGIN
  IF v_raw IS NULL OR v_raw !~ '^[0-9]+$' THEN
    RETURN NULL;
  END IF;
  RETURN v_raw::bigint;
END;
$$;

-- ── 3) Trigger-side writer (merges with a hand-written row of the same tx) ──
CREATE OR REPLACE FUNCTION public.write_task_activity_from_trigger(
  p_task_id integer,
  p_event_type text,
  p_old_value text,
  p_new_value text,
  p_fallback_actor integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx bigint := txid_current();
  v_actor integer := COALESCE(public.audit_actor_id(), p_fallback_actor);
  v_role text := COALESCE(
    public.audit_setting('actor_role'),
    CASE WHEN public.audit_actor_id() IS NULL THEN 'system' END
  );
  v_existing_id bigint;
BEGIN
  -- The application already logged this exact transition in this transaction
  -- (it wrote before the UPDATE): adopt that row and correct its old value.
  SELECT id
    INTO v_existing_id
    FROM public.task_activity_log
   WHERE task_id = p_task_id
     AND tx_id = v_tx
     AND event_type = p_event_type
     AND source = 'app'
     AND new_value IS NOT DISTINCT FROM p_new_value
   ORDER BY id DESC
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.task_activity_log
       SET old_value = p_old_value,
           source = 'trigger',
           app_merged = true,
           performed_by = COALESCE(performed_by, v_actor),
           role = COALESCE(role, v_role),
           context = COALESCE(context, public.audit_setting('change_context')),
           reference_id = COALESCE(reference_id, public.audit_reference_id()),
           reason = COALESCE(reason, public.audit_setting('change_reason'))
     WHERE id = v_existing_id;
    RETURN;
  END IF;

  INSERT INTO public.task_activity_log (
    task_id, event_type, performed_by, role, old_value, new_value,
    reason, reference_id, tx_id, source, context
  ) VALUES (
    p_task_id, p_event_type, v_actor, v_role, p_old_value, p_new_value,
    public.audit_setting('change_reason'), public.audit_reference_id(),
    v_tx, 'trigger', public.audit_setting('change_context')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.log_open_task_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_open_task_created ON public.open_tasks;
CREATE TRIGGER trg_log_open_task_created
  AFTER INSERT ON public.open_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.log_open_task_activity();

DROP TRIGGER IF EXISTS trg_log_open_task_changes ON public.open_tasks;
CREATE TRIGGER trg_log_open_task_changes
  AFTER UPDATE OF status, priority, due_date ON public.open_tasks
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.priority IS DISTINCT FROM NEW.priority
    OR OLD.due_date IS DISTINCT FROM NEW.due_date
  )
  EXECUTE FUNCTION public.log_open_task_activity();

-- ── 4) App-side inserts: stamp tx, merge into the trigger row ───────────────
CREATE OR REPLACE FUNCTION public.merge_app_task_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing public.task_activity_log%ROWTYPE;
BEGIN
  IF NEW.tx_id IS NULL THEN
    NEW.tx_id := txid_current();
  END IF;

  IF NEW.source <> 'app'
     OR NEW.event_type NOT IN ('created', 'status_change', 'priority_changed', 'rescheduled') THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO v_existing
    FROM public.task_activity_log
   WHERE task_id = NEW.task_id
     AND tx_id = NEW.tx_id
     AND event_type = NEW.event_type
     AND source = 'trigger'
     AND NOT app_merged
     AND new_value IS NOT DISTINCT FROM NEW.new_value
   ORDER BY id DESC
   LIMIT 1;

  -- Handlers that UPDATE and then log as separate autocommit statements
  -- (e.g. PATCH /open-tasks/:id) land in a different transaction. Accept the
  -- latest trigger row of this task/event if it is the same transition,
  -- seconds old and not yet claimed by another hand-written row.
  IF v_existing.id IS NULL THEN
    SELECT *
      INTO v_existing
      FROM public.task_activity_log
     WHERE task_id = NEW.task_id
       AND event_type = NEW.event_type
     ORDER BY id DESC
     LIMIT 1;

    IF v_existing.id IS NULL
       OR v_existing.source <> 'trigger'
       OR v_existing.app_merged
       OR v_existing.created_at < clock_timestamp() - interval '10 seconds'
       OR v_existing.new_value IS DISTINCT FROM NEW.new_value
       OR (NEW.old_value IS NOT NULL AND v_existing.old_value IS DISTINCT FROM NEW.old_value) THEN
      -- Logged before the UPDATE (or nothing changed): keep it; the open_tasks
      -- trigger adopts it if the change follows in this transaction.
      RETURN NEW;
    END IF;
  END IF;

  -- The trigger already recorded the change: enrich it, never touch old_value.
  UPDATE public.task_activity_log
     SET app_merged = true,
         reason = COALESCE(NEW.reason, reason),
         reference_id = COALESCE(NEW.reference_id, reference_id),
         performed_by = CASE WHEN performed_by IS NULL THEN NEW.performed_by ELSE performed_by END,
         role = CASE
                  WHEN performed_by IS NULL AND NEW.performed_by IS NOT NULL THEN COALESCE(NEW.role, role)
                  ELSE COALESCE(role, NEW.role)
                END
   WHERE id = v_existing.id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_merge_app_task_activity ON public.task_activity_log;
CREATE TRIGGER trg_merge_app_task_activity
  BEFORE INSERT ON public.task_activity_log
  FOR EACH ROW
  EXECUTE FUNCTION public.merge_app_task_activity();

-- ── 5) Visit task result revisions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visit_task_result_revisions (
  id bigserial PRIMARY KEY,
  visit_task_id bigint NOT NULL REFERENCES public.visit_tasks(id) ON DELETE CASCADE,
  visit_task_result_id bigint NOT NULL REFERENCES public.visit_task_results(id) ON DELETE CASCADE,
  open_task_id integer REFERENCES public.open_tasks(id) ON DELETE SET NULL,
  revision_no integer NOT NULL,
  final_decision varchar,
  reason_code varchar,
  payload jsonb NOT NULL,
  recorded_by integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
  recorded_role varchar(50),
  edit_reason text,
  source varchar(20) NOT NULL DEFAULT 'trigger'
    CHECK (source IN ('trigger', 'backfill')),
  tx_id bigint NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_visit_task_result_revisions_no UNIQUE (visit_task_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_visit_task_result_revisions_open_task
  ON public.visit_task_result_revisions (open_task_id);

COMMENT ON TABLE public.visit_task_result_revisions IS
  'Append-only history of visit task results. revision_no 1 = original entry; '
  'later revisions = edits/re-submissions. The live result stays in '
  'visit_task_results + its detail tables.';

CREATE OR REPLACE FUNCTION public.forbid_visit_task_result_revision_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'visit_task_result_revisions is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_visit_task_result_revision_update ON public.visit_task_result_revisions;
CREATE TRIGGER trg_forbid_visit_task_result_revision_update
  BEFORE UPDATE ON public.visit_task_result_revisions
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_visit_task_result_revision_update();

-- Full snapshot: the result row + every detail table keyed by
-- visit_task_result_id (discovered from the catalog, so new result types are
-- covered without touching this function).
CREATE OR REPLACE FUNCTION public.build_visit_task_result_payload(p_result_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_payload jsonb;
  v_details jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_table text;
BEGIN
  SELECT to_jsonb(r) INTO v_payload
    FROM public.visit_task_results r
   WHERE r.id = p_result_id;

  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_table IN
    SELECT c.relname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
     WHERE a.attname = 'visit_task_result_id'
       AND NOT a.attisdropped
       AND c.relkind = 'r'
       AND c.relnamespace = 'public'::regnamespace
       AND c.relname <> 'visit_task_result_revisions'
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'SELECT jsonb_agg(to_jsonb(t)) FROM public.%I t WHERE t.visit_task_result_id = $1',
      v_table
    ) INTO v_rows USING p_result_id;

    IF v_rows IS NOT NULL THEN
      v_details := v_details || jsonb_build_object(v_table, v_rows);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('result', v_payload, 'details', v_details);
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_visit_task_result()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx bigint := txid_current();
  v_result public.visit_task_results%ROWTYPE;
  v_open_task_id integer;
  v_previous public.visit_task_result_revisions%ROWTYPE;
  v_revision_id bigint;
  v_revision_no integer;
  v_actor integer;
  v_role text;
BEGIN
  -- Deferred to commit: read the final state, not the row of this event.
  SELECT * INTO v_result FROM public.visit_task_results WHERE id = NEW.id;
  IF v_result.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- One revision per transaction, however many times the row was touched.
  IF EXISTS (
    SELECT 1 FROM public.visit_task_result_revisions
     WHERE visit_task_id = v_result.visit_task_id AND tx_id = v_tx
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_previous
    FROM public.visit_task_result_revisions
   WHERE visit_task_id = v_result.visit_task_id
   ORDER BY revision_no DESC
   LIMIT 1;

  v_revision_no := COALESCE(v_previous.revision_no, 0) + 1;
  v_actor := COALESCE(public.audit_actor_id(), v_result.closed_by);
  v_role := COALESCE(
    public.audit_setting('actor_role'),
    CASE WHEN v_actor IS NULL THEN 'system' END
  );

  SELECT vt.source_open_task_id INTO v_open_task_id
    FROM public.visit_tasks vt
   WHERE vt.id = v_result.visit_task_id;

  INSERT INTO public.visit_task_result_revisions (
    visit_task_id, visit_task_result_id, open_task_id, revision_no,
    final_decision, reason_code, payload, recorded_by, recorded_role,
    edit_reason, tx_id
  ) VALUES (
    v_result.visit_task_id, v_result.id, v_open_task_id, v_revision_no,
    v_result.final_decision, v_result.reason_code,
    public.build_visit_task_result_payload(v_result.id),
    v_actor, v_role,
    CASE WHEN v_revision_no > 1 THEN public.audit_setting('change_reason') END,
    v_tx
  )
  RETURNING id INTO v_revision_id;

  IF v_open_task_id IS NOT NULL THEN
    INSERT INTO public.task_activity_log (
      task_id, event_type, performed_by, role, old_value, new_value,
      reason, reference_id, tx_id, source, context
    ) VALUES (
      v_open_task_id,
      CASE WHEN v_revision_no = 1 THEN 'result_recorded' ELSE 'result_edited' END,
      v_actor, v_role,
      v_previous.final_decision, v_result.final_decision,
      CASE WHEN v_revision_no > 1 THEN public.audit_setting('change_reason') END,
      v_revision_id, v_tx, 'trigger',
      CASE WHEN v_revision_no = 1 THEN 'visit_result' ELSE 'result_edit' END
    );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_visit_task_result ON public.visit_task_results;
CREATE CONSTRAINT TRIGGER trg_snapshot_visit_task_result
  AFTER INSERT OR UPDATE ON public.visit_task_results
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_visit_task_result();

-- ── 6) Seed: existing results become revision 1 (the original we still have)
INSERT INTO public.visit_task_result_revisions (
  visit_task_id, visit_task_result_id, open_task_id, revision_no,
  final_decision, reason_code, payload, recorded_by, recorded_role,
  source, tx_id, recorded_at
)
SELECT r.visit_task_id, r.id, vt.source_open_task_id, 1,
       r.final_decision, r.reason_code,
       public.build_visit_task_result_payload(r.id),
       r.closed_by, 'backfill', 'backfill', txid_current(),
       COALESCE(r.closed_at, r.created_at, now())
  FROM public.visit_task_results r
  JOIN public.visit_tasks vt ON vt.id = r.visit_task_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.visit_task_result_revisions x
    WHERE x.visit_task_id = r.visit_task_id
 );

COMMIT;
