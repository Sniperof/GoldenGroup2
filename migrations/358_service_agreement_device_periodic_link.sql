BEGIN;

ALTER TABLE public.service_agreements
  ADD COLUMN IF NOT EXISTS installed_device_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'service_agreements_installed_device_id_fkey'
      AND conrelid = 'public.service_agreements'::regclass
  ) THEN
    ALTER TABLE public.service_agreements
      ADD CONSTRAINT service_agreements_installed_device_id_fkey
      FOREIGN KEY (installed_device_id)
      REFERENCES public.installed_devices(id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE public.service_agreements sa
   SET installed_device_id = d.id
  FROM public.installed_devices d
 WHERE sa.installed_device_id IS NULL
   AND d.device_source = 'external'
   AND d.customer_id = sa.customer_id
   AND (
     (sa.external_device_serial IS NOT NULL AND btrim(sa.external_device_serial) <> ''
      AND (d.serial_number = sa.external_device_serial OR d.external_device_serial = sa.external_device_serial))
   );

CREATE INDEX IF NOT EXISTS idx_service_agreements_installed_device
  ON public.service_agreements (installed_device_id);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_service_agreements_active_device
  ON public.service_agreements (installed_device_id)
  WHERE installed_device_id IS NOT NULL
    AND status = 'active';

ALTER TABLE public.open_task_periodic_payload
  ADD COLUMN IF NOT EXISTS service_agreement_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'open_task_periodic_payload_service_agreement_id_fkey'
      AND conrelid = 'public.open_task_periodic_payload'::regclass
  ) THEN
    ALTER TABLE public.open_task_periodic_payload
      ADD CONSTRAINT open_task_periodic_payload_service_agreement_id_fkey
      FOREIGN KEY (service_agreement_id)
      REFERENCES public.service_agreements(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.service_agreements.installed_device_id IS
  'Optional FK to installed_devices. Required for external devices to be eligible for periodic maintenance.';

COMMENT ON COLUMN public.open_task_periodic_payload.service_agreement_id IS
  'Service agreement that provided the periodic maintenance plan for an external device.';

COMMIT;
