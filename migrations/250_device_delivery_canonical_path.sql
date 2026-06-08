-- 250_device_delivery_canonical_path.sql
-- Canonical device_delivery path:
-- open_task -> field_visit -> visit_task -> visit_task_results
--            + visit_task_device_delivery_results

ALTER TABLE public.task_type_config
  DROP CONSTRAINT IF EXISTS task_type_config_location_basis_check;

ALTER TABLE public.task_type_config
  ADD CONSTRAINT task_type_config_location_basis_check
  CHECK (location_basis IN ('client', 'contract', 'device'));

UPDATE public.task_type_config
   SET location_basis = 'device',
       task_family = 'delivery',
       contact_target_visit_type = 'service',
       updated_at = NOW()
 WHERE task_type = 'device_delivery';

ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_reason_check;

ALTER TABLE public.open_tasks
  ADD CONSTRAINT open_tasks_reason_check
  CHECK (reason IN (
    'new_lead', 'follow_up', 'renewal', 'service_request', 'other',
    'sale_delivery', 'post_maintenance_return', 'temporary_swap_delivery',
    'replacement_delivery', 'manual_delivery'
  ));

ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS source_context_type varchar(100),
  ADD COLUMN IF NOT EXISTS source_context_id bigint,
  ADD COLUMN IF NOT EXISTS dispatch_origin_type varchar(100),
  ADD COLUMN IF NOT EXISTS dispatch_origin_label text;

CREATE UNIQUE INDEX IF NOT EXISTS open_tasks_unique_active_device_delivery_per_device
  ON public.open_tasks (device_id)
  WHERE task_type = 'device_delivery'
    AND status NOT IN ('completed', 'closed', 'cancelled')
    AND device_id IS NOT NULL;

ALTER TABLE public.visit_task_device_delivery_results
  ADD COLUMN IF NOT EXISTS after_delivery_action varchar(50) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS installation_address_same_as_delivery boolean,
  ADD COLUMN IF NOT EXISTS installation_address text,
  ADD COLUMN IF NOT EXISTS installation_required_date date,
  ADD COLUMN IF NOT EXISTS update_device_main_address boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS new_installation_geo_unit_id integer,
  ADD COLUMN IF NOT EXISTS new_installation_address_text text,
  ADD COLUMN IF NOT EXISTS new_installation_lat numeric(10,7),
  ADD COLUMN IF NOT EXISTS new_installation_lng numeric(10,7);

ALTER TABLE public.visit_task_device_delivery_results
  DROP CONSTRAINT IF EXISTS visit_task_device_delivery_results_after_action_check;

ALTER TABLE public.visit_task_device_delivery_results
  ADD CONSTRAINT visit_task_device_delivery_results_after_action_check
  CHECK (after_delivery_action IN ('none', 'create_installation_task'));

ALTER TABLE public.visit_task_device_delivery_results
  ADD CONSTRAINT visit_task_device_delivery_results_new_geo_fkey
  FOREIGN KEY (new_installation_geo_unit_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.open_tasks.delivery_address IS
  'Canonical device_delivery execution address. Defaults from installed_devices installation address and does not update the device main address by itself.';

COMMENT ON TABLE public.visit_task_device_delivery_results IS
  'Canonical side table for device_delivery visit_task results. open_task_delivery_results is legacy and must not be used as canonical.';
