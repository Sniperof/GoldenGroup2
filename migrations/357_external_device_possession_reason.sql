BEGIN;

ALTER TABLE public.device_possession_log
  DROP CONSTRAINT IF EXISTS device_possession_reason_check;

ALTER TABLE public.device_possession_log
  ADD CONSTRAINT device_possession_reason_check
  CHECK (
    reason IN (
      'sale_delivery',
      'repair_pickup',
      'temporary_swap',
      'retrieval',
      'cancellation',
      'transfer',
      'external_registration'
    )
  );

COMMIT;
