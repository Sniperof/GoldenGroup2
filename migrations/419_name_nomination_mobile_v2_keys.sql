-- Align name-nomination mobile keys with the shared service-request vocabulary.
-- This is a breaking form-contract change, so v1 is replaced by an explicit v2
-- instead of accepting aliases silently in the immutable submitted payload.

BEGIN;

UPDATE public.service_request_type_config
SET default_form_version = 'name_nomination.mobile.v2',
    updated_at = NOW()
WHERE request_type = 'name_nomination';

DO $$
DECLARE
  configured_version TEXT;
BEGIN
  SELECT default_form_version
    INTO configured_version
    FROM public.service_request_type_config
   WHERE request_type = 'name_nomination';

  IF configured_version IS DISTINCT FROM 'name_nomination.mobile.v2' THEN
    RAISE EXCEPTION 'name_nomination registry v2 update failed; found %', configured_version;
  END IF;
END $$;

COMMIT;
