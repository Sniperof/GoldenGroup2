BEGIN;

ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS cancellation_reason_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'open_tasks_cancellation_reason_id_fkey'
       AND conrelid = 'public.open_tasks'::regclass
  ) THEN
    ALTER TABLE public.open_tasks
      ADD CONSTRAINT open_tasks_cancellation_reason_id_fkey
      FOREIGN KEY (cancellation_reason_id)
      REFERENCES public.system_lists(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.open_tasks.cancellation_reason_id IS
  'Validated system_lists reason used when an open task is cancelled before scheduling.';

COMMIT;
