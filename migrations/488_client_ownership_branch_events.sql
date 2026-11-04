-- 488: Branch ownership in the client ownership log (2026-11-01)
--
-- The log (481) only saw rows added to / removed from client_assignments. But a
-- client is personally owned only while one of its owners is ELIGIBLE (active
-- account, active employee, role holding clients.can_be_assigned); with none it
-- is the branch's. So an owner going on vacation, being suspended or leaving,
-- an account being disabled or a role losing the permission turned clients into
-- branch clients — and back — without a line in their log. Decisions:
--   D1  two owner events: owner_inactive (the owner stopped being eligible; the
--       ownership row stays) and owner_active (eligible again).
--   D2  one client event: branch_owned, written when the client is left with no
--       eligible owner — after a release, the removal of its last owner, or its
--       last owner going inactive. It is checked at COMMIT (deferred), so a
--       transfer (remove + add in one transaction) does not log a passage
--       through the branch.
--   D3  written by triggers on every table that decides eligibility (employees,
--       hr_users, role_permission_grants), like 475 / 480 / 481, so no path can
--       forget it. The operation's change_context labels the events when set
--       (the status change sets employee_status:<status>); otherwise the
--       trigger names the change.
--   D4  the current state is settled once at the end: owners already
--       ineligible get owner_inactive, and clients left without an eligible
--       owner get branch_owned (source backfill).

BEGIN;

-- ── 1) Event types ──────────────────────────────────────────────────────────
ALTER TABLE public.client_ownership_log
  DROP CONSTRAINT IF EXISTS client_ownership_log_event_type_check;
ALTER TABLE public.client_ownership_log
  ADD CONSTRAINT client_ownership_log_event_type_check
  CHECK (event_type IN ('owner_added', 'owner_removed', 'owner_inactive', 'owner_active', 'branch_owned'));

CREATE INDEX IF NOT EXISTS idx_client_ownership_log_owner
  ON public.client_ownership_log (client_id, owner_user_id, created_at DESC, id DESC);

-- ── 2) Eligibility ──────────────────────────────────────────────────────────
-- Mirrors eligiblePersonalOwnerCondition (packages/api/services/customerOwnership.ts
-- → assigneeEligibility.ts). Keep the two in step.
CREATE OR REPLACE FUNCTION public.client_owner_is_eligible(p_user_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.hr_users u
      JOIN public.employees e ON e.id = u.employee_id
     WHERE u.id = p_user_id
       AND u.is_active = TRUE
       AND e.status = 'active'
       AND EXISTS (
         SELECT 1
           FROM public.role_permission_grants g
           JOIN public.permissions p ON p.id = g.permission_id
          WHERE g.role_id = u.role_id
            AND p.key = 'clients.can_be_assigned'
       )
  );
$$;

-- ── 3) Owner events: compare each ownership with its last logged state (D1)
CREATE OR REPLACE FUNCTION public.sync_client_owner_eligibility(
  p_user_ids integer[],
  p_default_context text,
  p_source text DEFAULT 'trigger'
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
  v_event text;
  v_actor integer := public.audit_actor_id();
BEGIN
  FOR r IN
    SELECT ca.client_id,
           ca.hr_user_id,
           u.name AS owner_name,
           public.client_owner_is_eligible(ca.hr_user_id) AS eligible,
           (SELECT l.event_type
              FROM public.client_ownership_log l
             WHERE l.client_id = ca.client_id
               AND l.owner_user_id = ca.hr_user_id
               AND l.event_type IN ('owner_added', 'owner_removed', 'owner_inactive', 'owner_active')
             ORDER BY l.created_at DESC, l.id DESC
             LIMIT 1) AS last_event
      FROM public.client_assignments ca
      JOIN public.clients c ON c.id = ca.client_id
      LEFT JOIN public.hr_users u ON u.id = ca.hr_user_id
     WHERE ca.hr_user_id = ANY(p_user_ids)
  LOOP
    v_event := NULL;
    IF r.eligible AND r.last_event = 'owner_inactive' THEN
      v_event := 'owner_active';
    ELSIF NOT r.eligible AND r.last_event IS DISTINCT FROM 'owner_inactive' THEN
      v_event := 'owner_inactive';
    END IF;

    IF v_event IS NOT NULL THEN
      INSERT INTO public.client_ownership_log (
        client_id, event_type, owner_user_id, owner_name,
        change_context, reason, performed_by, role, source
      ) VALUES (
        r.client_id, v_event, r.hr_user_id, r.owner_name,
        COALESCE(public.audit_setting('change_context'), p_default_context),
        public.audit_setting('change_reason'),
        v_actor,
        COALESCE(public.audit_setting('actor_role'), CASE WHEN v_actor IS NULL THEN 'system' END),
        p_source
      );
    END IF;
  END LOOP;
END;
$$;

-- ── 4) Client event: left with no eligible owner → branch_owned (D2) ────────
-- Deferred to COMMIT. «Personal before» = some owner whose last state logged
-- BEFORE this transaction (created_at < now()) was added/active; without one
-- the client already was the branch's and nothing new happened.
CREATE OR REPLACE FUNCTION public.log_client_branch_owned()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = NEW.client_id) THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.client_assignments ca
     WHERE ca.client_id = NEW.client_id
       AND public.client_owner_is_eligible(ca.hr_user_id)
  ) THEN
    RETURN NULL;
  END IF;

  -- Another row of this transaction already logged it.
  IF EXISTS (
    SELECT 1 FROM public.client_ownership_log l
     WHERE l.client_id = NEW.client_id
       AND l.event_type = 'branch_owned'
       AND l.created_at = now()
  ) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM (
        SELECT DISTINCT ON (l.owner_user_id) l.event_type
          FROM public.client_ownership_log l
         WHERE l.client_id = NEW.client_id
           AND l.owner_user_id IS NOT NULL
           AND l.event_type IN ('owner_added', 'owner_removed', 'owner_inactive', 'owner_active')
           AND l.created_at < now()
         ORDER BY l.owner_user_id, l.created_at DESC, l.id DESC
      ) last_state
     WHERE last_state.event_type IN ('owner_added', 'owner_active')
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.client_ownership_log (
    client_id, event_type, owner_user_id, owner_name,
    change_context, reason, performed_by, role, source
  ) VALUES (
    NEW.client_id, 'branch_owned', NULL, NULL,
    NEW.change_context, NEW.reason, NEW.performed_by, NEW.role, NEW.source
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_client_branch_owned ON public.client_ownership_log;
CREATE CONSTRAINT TRIGGER trg_log_client_branch_owned
  AFTER INSERT ON public.client_ownership_log
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.event_type IN ('owner_removed', 'owner_inactive'))
  EXECUTE FUNCTION public.log_client_branch_owned();

-- ── 5) Triggers on what decides eligibility (D3) ────────────────────────────
CREATE OR REPLACE FUNCTION public.ownership_on_employee_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.sync_client_owner_eligibility(
    ARRAY(SELECT u.id FROM public.hr_users u WHERE u.employee_id = NEW.id),
    'employee_status:' || NEW.status
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ownership_on_employee_status ON public.employees;
CREATE TRIGGER trg_ownership_on_employee_status
  AFTER UPDATE OF status ON public.employees
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.ownership_on_employee_status();

CREATE OR REPLACE FUNCTION public.ownership_on_account_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.sync_client_owner_eligibility(
    ARRAY[NEW.id],
    CASE
      WHEN OLD.is_active IS DISTINCT FROM NEW.is_active
        THEN CASE WHEN NEW.is_active THEN 'account_activated' ELSE 'account_deactivated' END
      WHEN OLD.role_id IS DISTINCT FROM NEW.role_id THEN 'account_role_changed'
      ELSE 'account_relinked'
    END
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ownership_on_account_change ON public.hr_users;
CREATE TRIGGER trg_ownership_on_account_change
  AFTER UPDATE OF is_active, role_id, employee_id ON public.hr_users
  FOR EACH ROW
  WHEN (
    OLD.is_active IS DISTINCT FROM NEW.is_active
    OR OLD.role_id IS DISTINCT FROM NEW.role_id
    OR OLD.employee_id IS DISTINCT FROM NEW.employee_id
  )
  EXECUTE FUNCTION public.ownership_on_account_change();

-- Only clients.can_be_assigned decides eligibility; other grants are skipped.
CREATE OR REPLACE FUNCTION public.ownership_on_role_permission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_role_ids integer[] := ARRAY[]::integer[];
  v_key_id integer;
BEGIN
  SELECT id INTO v_key_id FROM public.permissions WHERE key = 'clients.can_be_assigned';
  IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.permission_id = v_key_id THEN
    v_role_ids := v_role_ids || OLD.role_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.permission_id = v_key_id THEN
    v_role_ids := v_role_ids || NEW.role_id;
  END IF;
  IF cardinality(v_role_ids) = 0 THEN
    RETURN NULL;
  END IF;

  PERFORM public.sync_client_owner_eligibility(
    ARRAY(SELECT u.id FROM public.hr_users u WHERE u.role_id = ANY(v_role_ids)),
    'role_permission_changed'
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ownership_on_role_permission ON public.role_permission_grants;
CREATE TRIGGER trg_ownership_on_role_permission
  AFTER INSERT OR UPDATE OR DELETE ON public.role_permission_grants
  FOR EACH ROW
  EXECUTE FUNCTION public.ownership_on_role_permission();

-- ── 6) Settle the current state (D4) ────────────────────────────────────────
SELECT public.sync_client_owner_eligibility(
  ARRAY(SELECT DISTINCT hr_user_id FROM public.client_assignments),
  'backfill',
  'backfill'
);

COMMIT;
