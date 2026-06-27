-- 335_periodic_maintenance_supersession.sql
-- Track periodic-maintenance tasks that were covered by another maintenance result
-- instead of being executed as standalone periodic visits.

ALTER TABLE public.open_task_periodic_payload
  ADD COLUMN IF NOT EXISTS superseded_by_open_task_id INTEGER REFERENCES public.open_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_reason VARCHAR(50),
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL;

ALTER TABLE public.open_task_periodic_payload
  DROP CONSTRAINT IF EXISTS open_task_periodic_payload_superseded_reason_check;

ALTER TABLE public.open_task_periodic_payload
  ADD CONSTRAINT open_task_periodic_payload_superseded_reason_check
    CHECK (
      superseded_reason IS NULL
      OR superseded_reason IN ('superseded_within_emergency', 'superseded_within_periodic')
    );

CREATE INDEX IF NOT EXISTS idx_periodic_payload_superseded_by_task
  ON public.open_task_periodic_payload (superseded_by_open_task_id)
  WHERE superseded_by_open_task_id IS NOT NULL;

COMMENT ON COLUMN public.open_task_periodic_payload.superseded_by_open_task_id IS
  'Host open_task whose result covered this periodic obligation without a standalone periodic result.';
COMMENT ON COLUMN public.open_task_periodic_payload.superseded_reason IS
  'superseded_within_emergency or superseded_within_periodic; reporting counts this separately from performed.';
