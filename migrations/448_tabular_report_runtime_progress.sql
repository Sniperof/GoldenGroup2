BEGIN;

CREATE TABLE IF NOT EXISTS public.report_run_runtime (
  report_run_id BIGINT PRIMARY KEY
    REFERENCES public.report_runs(id) ON DELETE CASCADE,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  progress_rows INTEGER NOT NULL DEFAULT 0 CHECK (progress_rows >= 0),
  progress_batches INTEGER NOT NULL DEFAULT 0 CHECK (progress_batches >= 0)
);

INSERT INTO public.report_run_runtime (
  report_run_id,
  heartbeat_at,
  progress_rows,
  progress_batches
)
SELECT id,
       COALESCE(heartbeat_at, started_at, requested_at, NOW()),
       progress_rows,
       progress_batches
  FROM public.report_runs
 WHERE status = 'running'
ON CONFLICT (report_run_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_report_run_runtime_heartbeat
  ON public.report_run_runtime (heartbeat_at, report_run_id);

COMMIT;
