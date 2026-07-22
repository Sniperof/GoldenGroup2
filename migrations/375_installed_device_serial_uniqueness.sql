BEGIN;

-- Empty text carries the same meaning as NULL (identity not known yet).
UPDATE public.installed_devices
   SET serial_number = NULL
 WHERE serial_number IS NOT NULL
   AND btrim(serial_number) = '';

-- Never guess which physical device owns a duplicated serial. The migration
-- stops with a compact reconciliation report so operations can correct the
-- affected rows before retrying it.
DO $$
DECLARE
  duplicate_summary text;
BEGIN
  SELECT string_agg(
           format('%s => device_ids=%s', duplicate_key, device_ids),
           '; '
           ORDER BY duplicate_key
         )
    INTO duplicate_summary
    FROM (
      SELECT lower(btrim(serial_number)) AS duplicate_key,
             array_agg(id ORDER BY id) AS device_ids
        FROM public.installed_devices
       WHERE serial_number IS NOT NULL
         AND btrim(serial_number) <> ''
       GROUP BY lower(btrim(serial_number))
      HAVING count(*) > 1
       ORDER BY lower(btrim(serial_number))
       LIMIT 25
    ) duplicates;

  IF duplicate_summary IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce installed-device serial uniqueness: %', duplicate_summary
      USING HINT = 'Correct the duplicated serial_number values, then rerun migration 375. Do not delete device rows automatically.';
  END IF;
END
$$;

-- A serial identifies one physical unit globally. Whitespace and letter case
-- are insignificant, while NULL remains allowed until the identity is known.
CREATE UNIQUE INDEX IF NOT EXISTS uq_installed_devices_serial_normalized
  ON public.installed_devices (lower(btrim(serial_number)))
  WHERE serial_number IS NOT NULL
    AND btrim(serial_number) <> '';

COMMIT;
