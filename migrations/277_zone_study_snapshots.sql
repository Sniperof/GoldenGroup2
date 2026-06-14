-- ============================================================
-- 277_zone_study_snapshots.sql
-- ============================================================
-- DEC-008 (D45): Zone Study snapshot storage.
-- One snapshot per (branch, date, user, mode). For mode='auto' the snapshot is
-- per-branch (user_id IS NULL); for mode='manual' it is per-user.
-- The "frozen after midnight" behaviour (DEC-008 D46 / ZS-R011) is computed
-- logically from date < CURRENT_DATE — there is no is_locked column.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.zone_study_snapshots (
  id            SERIAL PRIMARY KEY,
  branch_id     INTEGER NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  date          DATE NOT NULL,
  user_id       INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  mode          VARCHAR(20) NOT NULL CHECK (mode IN ('auto', 'manual')),
  snapshot_data JSONB NOT NULL,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One snapshot per (branch, date, user, mode). user_id is NULL for auto mode;
-- a partial unique index handles the NULL case that a plain UNIQUE cannot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_zone_study_snapshots_scoped
  ON public.zone_study_snapshots (branch_id, date, mode, COALESCE(user_id, 0));

CREATE INDEX IF NOT EXISTS idx_zone_study_snapshots_branch_date
  ON public.zone_study_snapshots (branch_id, date);

COMMIT;
