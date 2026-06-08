-- 255_contact_targets_device_work_location.sql
-- DEC-005 D27 surgical alignment:
-- contact_target grain is customer + work location + day.
-- Device-based task location is open_tasks.device_id -> installed_devices.installation_geo_unit_id.

ALTER TABLE public.task_type_config
  DROP CONSTRAINT IF EXISTS task_type_config_location_basis_check;

ALTER TABLE public.task_type_config
  ADD CONSTRAINT task_type_config_location_basis_check
  CHECK (location_basis IN ('client', 'contract', 'device'));

UPDATE public.task_type_config
   SET location_basis = 'device',
       updated_at = NOW()
 WHERE task_type IN (
   'device_delivery',
   'device_installation',
   'device_activation',
   'periodic_maintenance',
   'emergency_maintenance',
   'installment_collection',
   'maintenance_collection',
   'parts_sale',
   'device_retrieval',
   'device_repair',
   'device_return',
   'golden_warranty',
   'warranty_cancellation',
   'warranty_reactivation',
   'device_disconnection',
   'device_transfer'
 );

ALTER TABLE public.contact_targets
  DROP CONSTRAINT IF EXISTS contact_targets_visit_type_check;

ALTER TABLE public.contact_targets
  ADD CONSTRAINT contact_targets_visit_type_check
  CHECK (visit_type IN ('marketing', 'service', 'collection', 'mixed'));

UPDATE public.contact_targets
   SET work_location_geo_unit_id = COALESCE(work_location_geo_unit_id, zone_id),
       updated_at = NOW()
 WHERE work_location_geo_unit_id IS NULL
   AND zone_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_targets_customer_work_location_day
  ON public.contact_targets (branch_id, target_type, target_id, work_location_geo_unit_id, date)
  WHERE work_location_geo_unit_id IS NOT NULL;

COMMENT ON INDEX public.uq_contact_targets_customer_work_location_day IS
  'DEC-005 D27: one contact target per branch + target + work location + day. visit_type is derived/aggregate and not part of the grain.';
