BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.service_requests
     WHERE beneficiary_client_id IS NOT NULL
       AND beneficiary_candidate_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce service request beneficiary exclusivity: rows with both client and candidate links exist';
  END IF;
END
$$;

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_beneficiary_target_exclusive_ck;

ALTER TABLE public.service_requests
  ADD CONSTRAINT service_requests_beneficiary_target_exclusive_ck
  CHECK (beneficiary_client_id IS NULL OR beneficiary_candidate_id IS NULL);

COMMIT;
