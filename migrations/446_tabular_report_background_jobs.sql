BEGIN;

ALTER TABLE public.report_runs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS progress_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_batches INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_message TEXT;

UPDATE public.report_runs
   SET completed_at = COALESCE(completed_at, generated_at),
       requested_at = COALESCE(requested_at, generated_at)
 WHERE status = 'completed';

ALTER TABLE public.report_runs DROP CONSTRAINT IF EXISTS report_runs_status_check;
ALTER TABLE public.report_runs
  ADD CONSTRAINT report_runs_status_check
  CHECK (status IN ('queued','running','completed','failed'));

ALTER TABLE public.report_runs ALTER COLUMN status SET DEFAULT 'queued';

CREATE INDEX IF NOT EXISTS idx_report_runs_queue
  ON public.report_runs (requested_at, id)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_report_runs_running_heartbeat
  ON public.report_runs (heartbeat_at)
  WHERE status = 'running';

COMMIT;
