-- 489: Client activity log (2026-11-02)
--
-- Only the stage (client_audit_log) left a trace when a client changed; who
-- changed a phone, an address or the mediator, and from what, was unknown —
-- which is how a «شخصي» mediator overwritten by every edit went unnoticed.
-- Decisions:
--   D1  one append-only client_activity_log, written by a DATABASE TRIGGER on
--       clients so no write path can forget it (same approach as the task log
--       475, the employee log 480 and the ownership log 481). Actor, role,
--       reason and context come from the per-connection app.* settings (475).
--   D2  events: created, field_changed (one row per changed column, old → new
--       as readable text: names instead of ids, phone numbers instead of
--       JSON), deleted / restored (the soft delete).
--   D3  not logged here, because each already has its own history: rating
--       (client_rating_history), cooldown / do-not-contact
--       (client_contact_control_events), ownership (client_ownership_log).
--       Not logged as fields: the name parts (the full name is), the mediator
--       ids (its name and type are), the bookkeeping columns.
--   D4  a change made by another trigger (a mediator renamed elsewhere, 474)
--       is labelled mediator_renamed, not with the operation that caused it.
--   D5  new clients.activity_log.view, granted to the current holders of
--       clients.edit (GLOBAL / BRANCH).
--   D6  every existing client gets a «created» line at its created_at, so
--       the timeline starts where the client does (source backfill).

BEGIN;

-- ── 1) The log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_activity_log (
  id bigserial PRIMARY KEY,
  client_id integer NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('created', 'field_changed', 'deleted', 'restored')),
  -- field_changed: the clients column; other events: NULL.
  field_key varchar(60),
  old_value text,
  new_value text,
  -- client_created / candidate_converted / client_edit / client_deleted /
  -- mediator_renamed / backfill … or NULL (unlabelled path).
  change_context varchar(40),
  reason text,
  performed_by integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
  role varchar(50),
  source varchar(20) NOT NULL DEFAULT 'trigger' CHECK (source IN ('trigger', 'backfill')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_activity_log_client
  ON public.client_activity_log (client_id, created_at DESC, id DESC);

COMMENT ON TABLE public.client_activity_log IS
  'Append-only timeline of changes to a client record, written by a trigger on clients (migration 489).';

CREATE OR REPLACE FUNCTION public.forbid_client_activity_log_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'client_activity_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_client_activity_log_update ON public.client_activity_log;
CREATE TRIGGER trg_forbid_client_activity_log_update
  BEFORE UPDATE ON public.client_activity_log
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_client_activity_log_update();

-- ── 2) Readable values (D2) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_field_display(p_key text, p_value jsonb)
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

  IF p_key = 'contacts' THEN
    SELECT string_agg(NULLIF(trim(c ->> 'number'), ''), '، ' ORDER BY ord)
      INTO v_text
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::jsonb END)
           WITH ORDINALITY AS t(c, ord);
    RETURN v_text;
  ELSIF p_key = 'referrers' THEN
    SELECT string_agg(COALESCE(NULLIF(trim(r ->> 'referrerName'), ''), NULLIF(trim(r ->> 'name'), ''), '—'), '، ' ORDER BY ord)
      INTO v_text
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::jsonb END)
           WITH ORDINALITY AS t(r, ord);
    RETURN v_text;
  ELSIF p_key = 'gps_coordinates' THEN
    IF jsonb_typeof(p_value) = 'object' AND p_value ? 'lat' AND p_value ? 'lng' THEN
      RETURN (p_value ->> 'lat') || ', ' || (p_value ->> 'lng');
    END IF;
    RETURN p_value::text;
  END IF;

  v_text := CASE WHEN jsonb_typeof(p_value) = 'string' THEN p_value #>> '{}' ELSE p_value::text END;
  v_id := public.safe_int(v_text);

  IF p_key IN ('governorate', 'district', 'neighborhood') AND v_id IS NOT NULL THEN
    SELECT name INTO v_text FROM public.geo_units WHERE id = v_id;
  ELSIF p_key = 'branch_id' AND v_id IS NOT NULL THEN
    SELECT name INTO v_text FROM public.branches WHERE id = v_id;
  END IF;
  RETURN v_text;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_client_activity(
  p_client_id integer,
  p_event_type text,
  p_field_key text,
  p_old_value text,
  p_new_value text,
  p_context text,
  p_fallback_actor integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor integer := COALESCE(public.audit_actor_id(), p_fallback_actor);
BEGIN
  INSERT INTO public.client_activity_log (
    client_id, event_type, field_key, old_value, new_value,
    change_context, reason, performed_by, role
  ) VALUES (
    p_client_id, p_event_type, p_field_key, p_old_value, p_new_value,
    p_context, public.audit_setting('change_reason'), v_actor,
    COALESCE(public.audit_setting('actor_role'), CASE WHEN v_actor IS NULL THEN 'system' END)
  );
END;
$$;

-- ── 3) The trigger ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_client_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_context text;
BEGIN
  -- D4: written by another trigger (474 mediator-name sync).
  v_context := CASE
    WHEN pg_trigger_depth() > 1 THEN 'mediator_renamed'
    ELSE public.audit_setting('change_context')
  END;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_client_activity(NEW.id, 'created', NULL, NULL, NEW.name, v_context, NEW.created_by);
    RETURN NULL;
  END IF;

  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.write_client_activity(NEW.id, 'deleted', NULL, NULL, NULL, v_context, NEW.deleted_by);
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    PERFORM public.write_client_activity(NEW.id, 'restored', NULL, NULL, NULL, v_context);
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    -- D3: own histories, derived parts and bookkeeping.
    CONTINUE WHEN v_key IN (
      'id', 'created_at', 'created_by', 'deleted_at', 'deleted_by',
      'rating', 'cooldown_until', 'cooldown_reason', 'cooldown_set_by', 'cooldown_set_at', 'do_not_contact',
      'first_name', 'father_name', 'last_name',
      'referrer_id', 'referral_entity_id'
    );
    -- is_active follows the soft delete; logged only on its own.
    CONTINUE WHEN v_key = 'is_active' AND OLD.deleted_at IS DISTINCT FROM NEW.deleted_at;

    IF v_old -> v_key IS DISTINCT FROM v_new -> v_key THEN
      PERFORM public.write_client_activity(
        NEW.id, 'field_changed', v_key,
        public.client_field_display(v_key, v_old -> v_key),
        public.client_field_display(v_key, v_new -> v_key),
        v_context
      );
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_client_changes ON public.clients;
CREATE TRIGGER trg_log_client_changes
  AFTER INSERT OR UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.log_client_changes();

-- ── 4) Permission (D5) ──────────────────────────────────────────────────────
INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('clients.activity_log.view', 'clients', 'profile_activity_log', 'view',
   'عرض سجل تغييرات الزبون', 75, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT g.role_id, view_perm.id, g.scope_type
  FROM public.role_permission_grants g
  JOIN public.permissions edit_perm ON edit_perm.id = g.permission_id
                                   AND edit_perm.key = 'clients.edit'
 CROSS JOIN (SELECT id FROM public.permissions WHERE key = 'clients.activity_log.view') view_perm
 WHERE g.scope_type IN ('GLOBAL', 'BRANCH')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 5) Where the timeline starts (D6) ───────────────────────────────────────
INSERT INTO public.client_activity_log (
  client_id, event_type, new_value, change_context, performed_by, role, source, created_at
)
SELECT c.id, 'created', c.name, 'backfill', u.id, NULL, 'backfill', COALESCE(c.created_at, now())
  FROM public.clients c
  LEFT JOIN public.hr_users u ON u.id = c.created_by
 WHERE NOT EXISTS (
   SELECT 1 FROM public.client_activity_log l
    WHERE l.client_id = c.id AND l.event_type = 'created'
 );

COMMIT;
