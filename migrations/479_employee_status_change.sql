-- 479: Employee status change as an explicit operation (2026-10-12)
--
-- Status used to be a plain field of the employee edit form with no effect:
-- a suspended or terminated employee kept a working account (dev data had a
-- terminated employee with an active account). Decisions:
--   D1  suspended / terminated deactivate the linked system account(s);
--       returning to active re-enables them; vacation keeps the account.
--   D2  vacation / suspended / terminated are refused while the employee is in
--       the effective crew of an unfinished visit (enforced in the service).
--   D3  terminated is not final: back to active is allowed (with a reason).
--   D4  every change needs a reason from the managed list
--       `employee_status_change_reasons`; append-only history.
--   D5  permission employees.change_status (GLOBAL/BRANCH), granted to no role.
--   D6  vacation no longer releases the employee's open candidates (389 released
--       them for good on ANY exit from active); only suspended/terminated do.
-- Status is no longer written by the edit form (ignored server-side).

BEGIN;

-- ── 1) Permission (D5) — defined, granted to nobody ─────────────────────────
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES ('employees.change_status', 'employees', 'records', 'change_status',
        'تغيير حالة الموظف (إجازة / إيقاف / إنهاء خدمة / إعادة)', 95, ARRAY['GLOBAL', 'BRANCH']::text[])
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

-- ── 2) Managed reason list (D4) ─────────────────────────────────────────────
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'employee_status_change_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('annual_leave',        10, '{"label":"إجازة سنوية"}'),
  ('sick_leave',          20, '{"label":"إجازة مرضية"}'),
  ('disciplinary',        30, '{"label":"إجراء تأديبي"}'),
  ('investigation',       40, '{"label":"قيد التحقيق"}'),
  ('resignation',         50, '{"label":"استقالة"}'),
  ('dismissal',           60, '{"label":"فصل من العمل"}'),
  ('contract_ended',      70, '{"label":"انتهاء العقد"}'),
  ('return_to_work',      80, '{"label":"العودة إلى العمل"}'),
  ('rehire',              90, '{"label":"إعادة توظيف"}'),
  ('other',               99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
   WHERE sl.category = 'employee_status_change_reasons' AND sl.value = v.value
);

-- ── 3) History (D4) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_status_changes (
  id bigserial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  from_status varchar(50) NOT NULL,
  to_status varchar(50) NOT NULL
    CHECK (to_status IN ('active', 'vacation', 'suspended', 'terminated')),
  reason_id integer NOT NULL REFERENCES public.system_lists(id),
  note text,
  -- What happened to the linked system account(s): 'deactivated' | 'reactivated' | NULL.
  account_effect varchar(20) CHECK (account_effect IN ('deactivated', 'reactivated')),
  changed_by integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_status_changes_employee
  ON public.employee_status_changes (employee_id, changed_at);

COMMENT ON TABLE public.employee_status_changes IS
  'Append-only history of employee status changes (reason from employee_status_change_reasons).';

CREATE OR REPLACE FUNCTION public.forbid_employee_status_change_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'employee_status_changes is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_employee_status_change_update ON public.employee_status_changes;
CREATE TRIGGER trg_forbid_employee_status_change_update
  BEFORE UPDATE ON public.employee_status_changes
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_employee_status_change_update();

-- ── 4) D1 backstop: no active account for a suspended/terminated employee ──
-- Every path that (re)activates an account (system-account section, users
-- admin, tRPC) goes through hr_users; the database refuses there once.
CREATE OR REPLACE FUNCTION public.forbid_active_account_for_inactive_employee()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.is_active IS DISTINCT FROM TRUE OR NEW.employee_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.is_active IS NOT DISTINCT FROM NEW.is_active
     AND OLD.employee_id IS NOT DISTINCT FROM NEW.employee_id THEN
    RETURN NEW;  -- unrelated edit of an already-active account
  END IF;
  SELECT status INTO v_status FROM public.employees WHERE id = NEW.employee_id;
  IF v_status IN ('suspended', 'terminated') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      CONSTRAINT = 'hr_users_employee_status_active',
      MESSAGE = 'لا يمكن تفعيل حساب موظف موقوف أو منتهي الخدمة. غيّر حالة الموظف إلى «نشط» أولاً.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_active_account_for_inactive_employee ON public.hr_users;
CREATE TRIGGER trg_forbid_active_account_for_inactive_employee
  BEFORE INSERT OR UPDATE OF is_active, employee_id ON public.hr_users
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_active_account_for_inactive_employee();

-- ── 5) D6: a vacation keeps the employee's candidates ───────────────────────
-- 389 released open candidates to the branch, permanently, as soon as the
-- employee left «active» — a week of leave lost every assigned name. Now only
-- entering suspended/terminated releases them (from active OR from vacation).
-- The account-deactivation trigger (389) still releases on suspension too,
-- which is idempotent with this one.
CREATE OR REPLACE FUNCTION public.release_candidates_when_employee_inactive()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_hr_user_id INTEGER;
BEGIN
  IF NEW.status IN ('suspended', 'terminated')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status NOT IN ('suspended', 'terminated') THEN
    FOR linked_hr_user_id IN
      SELECT id FROM public.hr_users WHERE employee_id = NEW.id
    LOOP
      PERFORM public.release_open_candidates_for_hr_user(
        linked_hr_user_id,
        'responsible_employee_deactivated'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
