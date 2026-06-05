-- Preserve structured geo address inputs captured during device delivery.
-- Text columns remain for backwards compatibility and quick display.

ALTER TABLE public.visit_task_device_delivery_results
  ADD COLUMN IF NOT EXISTS delivery_geo_unit_id integer,
  ADD COLUMN IF NOT EXISTS delivery_address_text text,
  ADD COLUMN IF NOT EXISTS installation_geo_unit_id integer,
  ADD COLUMN IF NOT EXISTS installation_address_text text,
  ADD COLUMN IF NOT EXISTS installation_lat numeric(10,7),
  ADD COLUMN IF NOT EXISTS installation_lng numeric(10,7);

ALTER TABLE public.visit_task_device_delivery_results
  DROP CONSTRAINT IF EXISTS visit_task_device_delivery_results_delivery_geo_fkey;

ALTER TABLE public.visit_task_device_delivery_results
  ADD CONSTRAINT visit_task_device_delivery_results_delivery_geo_fkey
  FOREIGN KEY (delivery_geo_unit_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;

ALTER TABLE public.visit_task_device_delivery_results
  DROP CONSTRAINT IF EXISTS visit_task_device_delivery_results_installation_geo_fkey;

ALTER TABLE public.visit_task_device_delivery_results
  ADD CONSTRAINT visit_task_device_delivery_results_installation_geo_fkey
  FOREIGN KEY (installation_geo_unit_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.visit_task_device_delivery_results.delivery_geo_unit_id IS
  'Structured geo unit selected for the actual delivery address.';

COMMENT ON COLUMN public.visit_task_device_delivery_results.delivery_address_text IS
  'Detailed physical delivery address text, separate from the geo unit.';

COMMENT ON COLUMN public.visit_task_device_delivery_results.installation_geo_unit_id IS
  'Structured geo unit selected for the follow-up installation address.';

COMMENT ON COLUMN public.visit_task_device_delivery_results.installation_address_text IS
  'Detailed physical installation address text, separate from the geo unit.';
