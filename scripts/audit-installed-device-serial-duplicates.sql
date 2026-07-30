-- Read-only reconciliation report for migration 375.
-- Run against staging before applying the migration. Operations must decide
-- which row owns each physical serial; this script intentionally changes no data.
SELECT lower(btrim(d.serial_number)) AS normalized_serial,
       array_agg(d.id ORDER BY d.id) AS device_ids,
       array_agg(d.contract_id ORDER BY d.id) AS contract_ids,
       array_agg(d.customer_id ORDER BY d.id) AS customer_ids,
       array_agg(d.device_model_id ORDER BY d.id) AS device_model_ids,
       array_agg(d.device_source ORDER BY d.id) AS device_sources,
       array_agg(d.status ORDER BY d.id) AS device_statuses,
       count(*) AS duplicate_count
  FROM public.installed_devices d
 WHERE d.serial_number IS NOT NULL
   AND btrim(d.serial_number) <> ''
 GROUP BY lower(btrim(d.serial_number))
HAVING count(*) > 1
 ORDER BY count(*) DESC, lower(btrim(d.serial_number));
