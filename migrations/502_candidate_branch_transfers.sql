-- 502_candidate_branch_transfers.sql
--
-- A suggested name (candidate) can carry an address outside its branch's
-- coverage (11,277 open names on the production-scale copy, almost all migrated).
-- Conversion to a client requires BOTH the name's own branch AND an address
-- inside that branch's coverage, so such a name could never be converted and
-- there was no operation to hand it to the branch that actually covers it.
--
-- The new operation POST /api/candidates/:id/transfer-to-covering-branch moves
-- the name to the covering branch. This table is its audit trail: which branch
-- the name left, which it joined, the address that justified the move and how
-- the target was decided (auto-resolved from coverage vs. chosen by a GLOBAL
-- operator when coverage is ambiguous).

CREATE TABLE IF NOT EXISTS public.candidate_branch_transfers (
  id BIGSERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  from_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  to_branch_id INTEGER NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  geo_unit_id INTEGER REFERENCES public.geo_units(id) ON DELETE SET NULL,
  resolution VARCHAR(32) NOT NULL
    CHECK (resolution IN ('auto_resolved', 'operator_selected')),
  from_ownership_type VARCHAR(16) NOT NULL
    CHECK (from_ownership_type IN ('PERSONAL', 'BRANCH')),
  from_hr_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  transferred_by INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidate_branch_transfers_candidate
  ON public.candidate_branch_transfers(candidate_id, transferred_at DESC);
