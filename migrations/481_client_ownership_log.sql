-- 481: Client ownership log + its own view permission (2026-10-18)
--
-- Before this, client ownership (client_assignments) changed from six code
-- paths — the client edit form, client creation, candidate conversion and
-- linking, the OP promotion at contract approval, and the soft delete — and
-- none of them left a trace. Decisions (ownership model, phase 1):
--   D1  one append-only client_ownership_log, written by a DATABASE TRIGGER on
--       client_assignments so no write path can forget it (same approach as
--       the task log 475 and the employee log 480). The actor, reason and
--       context come from the per-connection app.* settings (475).
--   D2  ownership leaves the client edit form and becomes its own operations
--       (add / remove / transfer / release) with a mandatory reason; the
--       manage permission stays clients.assignment.manage, renamed.
--   D3  new clients.ownership.view gates the «الملكية» tab and its log;
--       granted to the current holders of clients.assignment.manage.
--   D4  existing rows are backfilled as owner_added at their assigned_at.

BEGIN;

-- ── 1) The log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_ownership_log (
  id bigserial PRIMARY KEY,
  client_id integer NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('owner_added', 'owner_removed')),
  owner_user_id integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
  -- Name at the time of the event, so the line still reads after a rename or
  -- an account removal.
  owner_name text,
  -- Why the row changed: manual_add / manual_remove / manual_transfer /
  -- manual_release, client_created, candidate_converted, candidate_linked,
  -- sale_op, status_op_fop, client_deleted, edit_form (legacy) or NULL
  -- (unlabelled system path).
  change_context varchar(40),
  reason text,
  performed_by integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
  role varchar(50),
  source varchar(20) NOT NULL DEFAULT 'trigger' CHECK (source IN ('trigger', 'backfill')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_ownership_log_client
  ON public.client_ownership_log (client_id, created_at DESC, id DESC);

COMMENT ON TABLE public.client_ownership_log IS
  'Append-only history of client ownership changes, written by a trigger on client_assignments (migration 481).';

CREATE OR REPLACE FUNCTION public.forbid_client_ownership_log_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'client_ownership_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_client_ownership_log_update ON public.client_ownership_log;
CREATE TRIGGER trg_forbid_client_ownership_log_update
  BEFORE UPDATE ON public.client_ownership_log
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_client_ownership_log_update();

-- ── 2) The trigger on client_assignments ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_client_ownership_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.client_assignments%ROWTYPE;
  v_event text;
  v_actor integer;
  v_owner integer;
  v_owner_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_row := NEW;
    v_event := 'owner_added';
  ELSE
    v_row := OLD;
    v_event := 'owner_removed';
  END IF;

  -- A hard delete of the client cascades here after the client row is gone:
  -- the log rows go with it, nothing to write.
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_row.client_id) THEN
    RETURN NULL;
  END IF;

  SELECT id, name INTO v_owner, v_owner_name FROM public.hr_users WHERE id = v_row.hr_user_id;

  v_actor := public.audit_actor_id();
  IF v_actor IS NULL AND TG_OP = 'INSERT' THEN
    SELECT id INTO v_actor FROM public.hr_users WHERE id = NEW.assigned_by;
  END IF;

  INSERT INTO public.client_ownership_log (
    client_id, event_type, owner_user_id, owner_name,
    change_context, reason, performed_by, role
  ) VALUES (
    v_row.client_id, v_event, v_owner, v_owner_name,
    public.audit_setting('change_context'),
    public.audit_setting('change_reason'),
    v_actor,
    COALESCE(public.audit_setting('actor_role'), CASE WHEN v_actor IS NULL THEN 'system' END)
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_client_ownership_change ON public.client_assignments;
CREATE TRIGGER trg_log_client_ownership_change
  AFTER INSERT OR DELETE ON public.client_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.log_client_ownership_change();

-- ── 3) Backfill the current owners (D4) ─────────────────────────────────────
INSERT INTO public.client_ownership_log (
  client_id, event_type, owner_user_id, owner_name,
  change_context, performed_by, role, source, created_at
)
SELECT ca.client_id, 'owner_added', u.id, u.name,
       'backfill', ab.id, NULL, 'backfill', COALESCE(ca.assigned_at, now())
  FROM public.client_assignments ca
  LEFT JOIN public.hr_users u ON u.id = ca.hr_user_id
  LEFT JOIN public.hr_users ab ON ab.id = ca.assigned_by
 WHERE NOT EXISTS (
   SELECT 1 FROM public.client_ownership_log l
    WHERE l.client_id = ca.client_id
      AND l.owner_user_id = ca.hr_user_id
      AND l.source = 'backfill'
 );

-- ── 4) Permissions (D2, D3) ─────────────────────────────────────────────────
UPDATE public.permissions
   SET display_name = 'إدارة ملكية الزبون'
 WHERE key = 'clients.assignment.manage';

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('clients.ownership.view', 'clients', 'profile_ownership', 'view',
   'عرض ملكية الزبون وسجلها', 74, ARRAY['GLOBAL','BRANCH'])
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
  JOIN public.permissions manage_perm ON manage_perm.id = g.permission_id
                                     AND manage_perm.key = 'clients.assignment.manage'
 CROSS JOIN (SELECT id FROM public.permissions WHERE key = 'clients.ownership.view') view_perm
 WHERE g.scope_type IN ('GLOBAL', 'BRANCH')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
