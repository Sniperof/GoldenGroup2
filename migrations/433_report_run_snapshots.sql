BEGIN;

-- 432 may already be recorded in schema_migrations from the first reporting
-- foundation revision. Add the later manual-generation snapshot tables through
-- a new forward-only migration so existing environments receive them too.
CREATE TABLE IF NOT EXISTS public.report_runs (
  id BIGSERIAL PRIMARY KEY,
  report_key TEXT NOT NULL,
  generated_by INTEGER NOT NULL REFERENCES public.hr_users(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('GLOBAL', 'BRANCH', 'ASSIGNED')),
  branch_ids INTEGER[] NOT NULL DEFAULT '{}',
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_runs_actor_created
  ON public.report_runs (generated_by, generated_at DESC);

CREATE TABLE IF NOT EXISTS public.report_run_rows (
  run_id BIGINT NOT NULL REFERENCES public.report_runs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  row_data JSONB NOT NULL,
  PRIMARY KEY (run_id, row_number)
);

ALTER TABLE public.report_export_audit
  ADD COLUMN IF NOT EXISTS report_run_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.report_export_audit'::regclass
      AND conname = 'report_export_audit_report_run_id_fkey'
  ) THEN
    ALTER TABLE public.report_export_audit
      ADD CONSTRAINT report_export_audit_report_run_id_fkey
      FOREIGN KEY (report_run_id) REFERENCES public.report_runs(id);
  END IF;
END $$;

COMMIT;
