-- Repair partial schema drift from 323_device_retrieval_task.sql.
-- These fields preserve the customer's device location before a successful
-- maintenance retrieval moves the installed device to the service branch.

BEGIN;

ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS pre_retrieval_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pre_retrieval_geo_unit_id INTEGER REFERENCES public.geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pre_retrieval_address_text TEXT,
  ADD COLUMN IF NOT EXISTS pre_retrieval_lat NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS pre_retrieval_lng NUMERIC(10, 7);

COMMENT ON COLUMN public.open_tasks.pre_retrieval_branch_id IS
  'Branch snapshot before a device retrieval moves the device to a workshop.';
COMMENT ON COLUMN public.open_tasks.pre_retrieval_geo_unit_id IS
  'Geographic-unit snapshot before a device retrieval moves the device to a workshop.';
COMMENT ON COLUMN public.open_tasks.pre_retrieval_address_text IS
  'Address snapshot before a device retrieval moves the device to a workshop.';
COMMENT ON COLUMN public.open_tasks.pre_retrieval_lat IS
  'Latitude snapshot before a device retrieval moves the device to a workshop.';
COMMENT ON COLUMN public.open_tasks.pre_retrieval_lng IS
  'Longitude snapshot before a device retrieval moves the device to a workshop.';

COMMIT;
