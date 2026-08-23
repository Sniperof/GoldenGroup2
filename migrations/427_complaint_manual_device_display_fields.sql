BEGIN;

-- 425 was already executed in some environments before CRM manual-device
-- display fields were appended to that file. Keep existing databases aligned
-- without requiring an old migration to be replayed.
ALTER TABLE public.complaint_device_details
  ADD COLUMN IF NOT EXISTS manual_device_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS manual_device_serial VARCHAR(255);

COMMIT;
