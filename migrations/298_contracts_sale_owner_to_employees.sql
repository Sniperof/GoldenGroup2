-- ============================================================
-- 298_contracts_sale_owner_to_employees.sql
-- ============================================================
-- Sale-owner model correction, decided 2026-06-17 during the contracts section
-- permission audit.
--
-- THE PROBLEM: نسبة البيعة (sale attribution) belongs to an EMPLOYEE — the deal
-- originator, who may be a team supervisor of a successfully-sold device-demo,
-- or any active staff member — REGARDLESS of whether that person has a system
-- login. But contracts.sale_owner_id was FK'd to hr_users(id), which made
-- attribution to the 50% of employees WITHOUT an hr_users account impossible.
--
-- This also resolves two earlier band-aids that pointed the wrong way:
--   - GAP-080 forced the form dropdown to emit hr_users.id (hiding accountless
--     employees) — the wrong direction; reverted in the same change.
--   - GAP-083 (the auto-fill writing an employees.id into an hr_users FK) simply
--     dissolves once the column references employees(id): the offer team
--     snapshot already carries employees.id, so the auto-fill becomes correct.
--
-- closing_employee_id is intentionally LEFT on hr_users — التسكير is a
-- permission-gated ACTION (contracts.close), so the closer is always a real
-- system user, distinct from the sale owner.
--
-- DATA MIGRATION: existing sale_owner_id values are hr_users.id (all current
-- rows were set via the post-GAP-080 dropdown; none were auto-filled — verified
-- offer_team_snapshot.supervisor IS NULL on every row). We translate each to the
-- linked employees.id via hr_users.employee_id; any value that does not resolve
-- to an employee is cleared (orphan attribution) so the new FK can be added.
--
-- Idempotent: guarded by the FK's current target so re-running is a no-op.
-- ============================================================

BEGIN;

-- Only run the repoint while the column still references hr_users. Once it
-- references employees, every step below is skipped (idempotent re-run).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contracts_sale_owner_id_fkey'
      AND confrelid = 'public.hr_users'::regclass
  ) THEN
    -- 1) Drop the old FK → hr_users.
    ALTER TABLE public.contracts DROP CONSTRAINT contracts_sale_owner_id_fkey;

    -- 2) Backfill: hr_users.id → employees.id (via the account's employee link).
    --    NULL out any value that doesn't resolve to a real employee.
    UPDATE public.contracts c
       SET sale_owner_id = u.employee_id
      FROM public.hr_users u
     WHERE c.sale_owner_id IS NOT NULL
       AND u.id = c.sale_owner_id;

    UPDATE public.contracts c
       SET sale_owner_id = NULL
     WHERE c.sale_owner_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = c.sale_owner_id);

    -- 3) Add the new FK → employees (preserve ON DELETE SET NULL semantics).
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_sale_owner_id_fkey
      FOREIGN KEY (sale_owner_id) REFERENCES public.employees(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
