BEGIN;

ALTER TABLE public.complaints
  DROP CONSTRAINT IF EXISTS complaints_entry_point_ck;

ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_entry_point_ck CHECK (entry_point IN (
    'home',
    'visit_detail',
    'device_detail',
    'crm_general',
    'crm_client',
    'crm_visit',
    'crm_device'
  ));

COMMIT;
