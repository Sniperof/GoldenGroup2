-- 498: Installed-device activity log (2026-11-19)
--
-- A device's status is written by a dozen paths (eight visit-result appliers,
-- contract approval and cancellation, delivery suspension, the manual edit,
-- the legacy open-task completion, external registration, service-request
-- promotion). Nothing recorded who moved a device from one status to another,
-- or why. Same approach as the client log (489):
--   D1  one append-only device_activity_log, written by a DATABASE TRIGGER on
--       installed_devices so no write path can forget it. Actor and role come
--       from the per-connection app.* settings (475).
--   D2  events: created, status_changed (its own type: the device's lifecycle
--       reads from it), field_changed (one row per other changed column,
--       old → new as readable text: names instead of ids).
--   D3  the operation: app.device_context (transaction-local, set by the
--       device paths and read only here, so the task log is untouched), else
--       app.change_context; the reason likewise (app.device_reason, else
--       app.change_reason). A visit result also sets app.visit_task_id, and
--       the row keeps the visit task and its type so «نتيجة مهمة تسليم» can be
--       told from «نتيجة مهمة تركيب».
--   D4  not logged as fields: bookkeeping (id, created_at, updated_at),
--       device_model_id (the model name is), activated_at (stamped by its own
--       trigger with the move to active), and the golden-warranty mirror
--       (is_golden_warranty, golden_warranty_end_date), derived from
--       device_warranties, which keeps its own rows.
--   D5  new installed_devices.activity_log.view (GLOBAL / BRANCH), granted to
--       the current holders of the device edit keys (contracts.edit,
--       installed_devices.update_service_data) at the same scope.
--       New installed_devices.lifecycle.view (GLOBAL / BRANCH / ASSIGNED),
--       granted to the current holders of the three keys that open a device
--       (installed_devices.view, clients.devices.view, contracts.view_list)
--       at the same scope, so nobody gains or loses anything the day it lands.
--   D6  every existing device gets a «created» line at its created_at, so the
--       log starts where the device does (source backfill). Earlier status
--       moves are NOT reconstructed here; the lifecycle tab derives them from
--       the dates and task results already stored.

BEGIN;

-- ── 1) The log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_activity_log (
  id bigserial PRIMARY KEY,
  device_id integer NOT NULL REFERENCES public.installed_devices(id) ON DELETE CASCADE,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('created', 'status_changed', 'field_changed')),
  -- field_changed: the installed_devices column; status_changed: 'status'; created: NULL.
  field_key varchar(60),
  old_value text,
  new_value text,
  -- contract_approved / contract_cancelled / device_edit / visit_result / … or NULL.
  change_context varchar(60),
  -- A visit result: the visit task and its type (D3).
  visit_task_id integer REFERENCES public.visit_tasks(id) ON DELETE SET NULL,
  task_type varchar(60),
  reason text,
  performed_by integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
  role varchar(50),
  source varchar(20) NOT NULL DEFAULT 'trigger' CHECK (source IN ('trigger', 'backfill')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_activity_log_device
  ON public.device_activity_log (device_id, created_at DESC, id DESC);

COMMENT ON TABLE public.device_activity_log IS
  'Append-only timeline of changes to an installed device, written by a trigger on installed_devices (migration 498).';

CREATE OR REPLACE FUNCTION public.forbid_device_activity_log_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'device_activity_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_device_activity_log_update ON public.device_activity_log;
CREATE TRIGGER trg_forbid_device_activity_log_update
  BEFORE UPDATE ON public.device_activity_log
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_device_activity_log_update();

-- ── 2) Readable values (D2) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.device_field_display(p_key text, p_value jsonb)
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

  IF p_key = 'installation_geo_unit_id' AND v_id IS NOT NULL THEN
    SELECT name INTO v_text FROM public.geo_units WHERE id = v_id;
  ELSIF p_key = 'branch_id' AND v_id IS NOT NULL THEN
    SELECT name INTO v_text FROM public.branches WHERE id = v_id;
  ELSIF p_key = 'customer_id' AND v_id IS NOT NULL THEN
    SELECT name INTO v_text FROM public.clients WHERE id = v_id;
  ELSIF p_key = 'contract_id' AND v_id IS NOT NULL THEN
    SELECT COALESCE(contract_number, '#' || id) INTO v_text FROM public.contracts WHERE id = v_id;
  END IF;
  RETURN v_text;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_device_activity(
  p_device_id integer,
  p_event_type text,
  p_field_key text,
  p_old_value text,
  p_new_value text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor integer := public.audit_actor_id();
  v_context text := COALESCE(public.audit_setting('device_context'), public.audit_setting('change_context'));
  v_visit_task_raw text := public.audit_setting('visit_task_id');
  v_visit_task_id integer;
  v_task_type text;
BEGIN
  IF v_visit_task_raw ~ '^[0-9]+$' THEN
    SELECT vt.id, vt.task_type INTO v_visit_task_id, v_task_type
      FROM public.visit_tasks vt WHERE vt.id = v_visit_task_raw::integer;
  END IF;

  INSERT INTO public.device_activity_log (
    device_id, event_type, field_key, old_value, new_value,
    change_context, visit_task_id, task_type, reason, performed_by, role
  ) VALUES (
    p_device_id, p_event_type, p_field_key, p_old_value, p_new_value,
    v_context, v_visit_task_id, v_task_type,
    COALESCE(public.audit_setting('device_reason'), public.audit_setting('change_reason')), v_actor,
    COALESCE(public.audit_setting('actor_role'), CASE WHEN v_actor IS NULL THEN 'system' END)
  );
END;
$$;

-- ── 3) The trigger ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_device_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_key text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_device_activity(NEW.id, 'created', NULL, NULL, NEW.status);
    RETURN NULL;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.write_device_activity(NEW.id, 'status_changed', 'status', OLD.status, NEW.status);
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    -- D4: bookkeeping, derived and mirrored columns; status has its own event.
    CONTINUE WHEN v_key IN (
      'id', 'created_at', 'updated_at', 'status',
      'device_model_id', 'activated_at',
      'is_golden_warranty', 'golden_warranty_end_date'
    );
    IF v_old -> v_key IS DISTINCT FROM v_new -> v_key THEN
      PERFORM public.write_device_activity(
        NEW.id, 'field_changed', v_key,
        public.device_field_display(v_key, v_old -> v_key),
        public.device_field_display(v_key, v_new -> v_key)
      );
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_device_changes ON public.installed_devices;
CREATE TRIGGER trg_log_device_changes
  AFTER INSERT OR UPDATE ON public.installed_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.log_device_changes();

-- ── 4) Permissions (D5) ─────────────────────────────────────────────────────
INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('installed_devices.activity_log.view', 'devices', 'installed_device_activity_log', 'view',
   'عرض سجل تغييرات الجهاز', 222, ARRAY['GLOBAL','BRANCH']),
  ('installed_devices.lifecycle.view', 'devices', 'installed_device_lifecycle', 'view',
   'عرض دورة حياة الجهاز', 223, ARRAY['GLOBAL','BRANCH','ASSIGNED'])
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT DISTINCT ON (g.role_id) g.role_id, target.id, g.scope_type
  FROM public.role_permission_grants g
  JOIN public.permissions source ON source.id = g.permission_id
                                AND source.key IN ('contracts.edit', 'installed_devices.update_service_data')
 CROSS JOIN (SELECT id FROM public.permissions WHERE key = 'installed_devices.activity_log.view') target
 WHERE g.scope_type IN ('GLOBAL', 'BRANCH')
 ORDER BY g.role_id, CASE g.scope_type WHEN 'GLOBAL' THEN 1 ELSE 2 END
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT DISTINCT ON (g.role_id) g.role_id, target.id, g.scope_type
  FROM public.role_permission_grants g
  JOIN public.permissions source ON source.id = g.permission_id
                                AND source.key IN ('installed_devices.view', 'clients.devices.view', 'contracts.view_list')
 CROSS JOIN (SELECT id FROM public.permissions WHERE key = 'installed_devices.lifecycle.view') target
 WHERE g.scope_type IN ('GLOBAL', 'BRANCH', 'ASSIGNED')
 -- The widest scope a role already has on a device-opening key.
 ORDER BY g.role_id, CASE g.scope_type WHEN 'GLOBAL' THEN 1 WHEN 'BRANCH' THEN 2 ELSE 3 END
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 5) Where the log starts (D6) ────────────────────────────────────────────
INSERT INTO public.device_activity_log (
  device_id, event_type, new_value, change_context, role, source, created_at
)
-- new_value stays empty: the status at creation is not known for old rows.
SELECT d.id, 'created', NULL, 'backfill', NULL, 'backfill', COALESCE(d.created_at, now())
  FROM public.installed_devices d
 WHERE NOT EXISTS (
   SELECT 1 FROM public.device_activity_log l
    WHERE l.device_id = d.id AND l.event_type = 'created'
 );

COMMIT;
