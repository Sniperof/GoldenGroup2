-- Preserve the contact context captured by telemarketing when a field visit is booked.
-- The generic origin_id is BIGINT, while telemarketing_call_logs.id is VARCHAR,
-- so a dedicated reference is required to keep the booking traceable.

ALTER TABLE public.field_visits
  ADD COLUMN IF NOT EXISTS field_instructions TEXT,
  ADD COLUMN IF NOT EXISTS booking_call_log_id VARCHAR(100);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'field_visits_booking_call_log_id_fkey'
       AND conrelid = 'public.field_visits'::regclass
  ) THEN
    ALTER TABLE public.field_visits
      ADD CONSTRAINT field_visits_booking_call_log_id_fkey
      FOREIGN KEY (booking_call_log_id)
      REFERENCES public.telemarketing_call_logs(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'field_visits_answered_by_check'
       AND conrelid = 'public.field_visits'::regclass
  ) THEN
    ALTER TABLE public.field_visits
      ADD CONSTRAINT field_visits_answered_by_check
      CHECK (answered_by IS NULL OR answered_by IN ('customer', 'spouse', 'child', 'other'))
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_field_visits_booking_call_log_id
  ON public.field_visits (booking_call_log_id)
  WHERE booking_call_log_id IS NOT NULL;

COMMENT ON COLUMN public.field_visits.field_instructions IS
  'Pre-visit instructions written by telemarketing for the assigned field team; distinct from field_notes authored during/after execution.';

COMMENT ON COLUMN public.field_visits.booking_call_log_id IS
  'Telemarketing call log that produced this booking. Kept separate because the canonical call-log identifier is textual.';
