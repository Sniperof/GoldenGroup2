-- ============================================================
-- 386_employee_branch_source_of_truth.sql
-- ============================================================
-- The employee record (employees.branch_id) is the single source of truth for
-- the branch of any account linked to it (hr_users.employee_id IS NOT NULL).
--
-- This migration:
--   1. Creates employee_branch_transfers (audit trail for explicit transfers).
--   2. Reconciles existing data so every employee-linked account has EXACTLY one
--      active branch assignment = its employee's branch (deactivating any others),
--      and mirrors it into the legacy hr_users.branch_id column.
--
-- Accounts NOT linked to an employee (super admins, admin-created users) are left
-- untouched — they keep their manually-managed branch assignments.
-- ============================================================

BEGIN;

-- 1) Audit trail --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_branch_transfers (
  id            BIGSERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  from_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  to_branch_id  INTEGER NOT NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  transferred_by INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_branch_transfers_employee
  ON public.employee_branch_transfers (employee_id, created_at DESC);

-- 2) Reconcile existing employee-linked accounts to their employee branch ------

-- 2a. Deactivate any active assignment whose branch != the employee's branch.
UPDATE public.user_branch_assignments uba
   SET status = 'inactive',
       is_primary = FALSE,
       updated_at = NOW()
  FROM public.hr_users u
  JOIN public.employees e ON e.id = u.employee_id
 WHERE uba.user_id = u.id
   AND u.employee_id IS NOT NULL
   AND e.branch_id IS NOT NULL
   AND uba.branch_id <> e.branch_id
   AND uba.status = 'active';

-- 2b. Ensure the employee-branch assignment exists as active + primary.
INSERT INTO public.user_branch_assignments (user_id, branch_id, is_primary, status)
SELECT u.id, e.branch_id, TRUE, 'active'
  FROM public.hr_users u
  JOIN public.employees e ON e.id = u.employee_id
 WHERE u.employee_id IS NOT NULL
   AND e.branch_id IS NOT NULL
ON CONFLICT (user_id, branch_id) DO UPDATE
  SET is_primary = TRUE,
      status = 'active',
      updated_at = NOW();

-- 2c. Clear any lingering primary flag on other branches for these accounts.
UPDATE public.user_branch_assignments uba
   SET is_primary = FALSE,
       updated_at = NOW()
  FROM public.hr_users u
  JOIN public.employees e ON e.id = u.employee_id
 WHERE uba.user_id = u.id
   AND u.employee_id IS NOT NULL
   AND e.branch_id IS NOT NULL
   AND uba.branch_id <> e.branch_id
   AND uba.is_primary = TRUE;

-- 2d. Mirror into the legacy hr_users.branch_id column.
UPDATE public.hr_users u
   SET branch_id = e.branch_id
  FROM public.employees e
 WHERE e.id = u.employee_id
   AND u.employee_id IS NOT NULL
   AND e.branch_id IS NOT NULL
   AND u.branch_id IS DISTINCT FROM e.branch_id;

COMMIT;
