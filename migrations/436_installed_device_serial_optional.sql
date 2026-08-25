-- 436_installed_device_serial_optional.sql
-- A device may be registered before its physical serial is known. Empty input
-- is normalized to NULL by the application; every non-empty serial remains
-- globally unique after trimming and case-folding.

BEGIN;

ALTER TABLE public.installed_devices
  ALTER COLUMN serial_number DROP NOT NULL;

UPDATE public.installed_devices
   SET serial_number = NULL
 WHERE serial_number IS NOT NULL
   AND btrim(serial_number) = '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_installed_devices_serial_normalized
  ON public.installed_devices (lower(btrim(serial_number)))
  WHERE serial_number IS NOT NULL
    AND btrim(serial_number) <> '';

COMMIT;
