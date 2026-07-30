-- Allow visit source snapshots to represent a personal owner whose role is
-- eligible via clients.can_be_assigned without being a supervisor/technician
-- team slot.
BEGIN;

ALTER TABLE public.visit_sources
  DROP CONSTRAINT IF EXISTS visit_sources_source_type_check;

ALTER TABLE public.visit_sources
  ADD CONSTRAINT visit_sources_source_type_check
  CHECK (
    source_type = ANY (
      ARRAY[
        'supervisor',
        'technician',
        'both',
        'employee',
        'company_branch',
        'company_global'
      ]::varchar[]
    )
  );

COMMIT;
