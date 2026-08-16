-- 402_water_check_form_v2_referrer_name.sql
--
-- Bumps the water_check mobile form to v2, which adds the REFERRER'S NAME to
-- `for_another` submissions.
--
-- Why a version bump and not a silent widening: the field is required for
-- visitors, so a v1 client that keeps submitting without it would be storing
-- anonymous referrals. The version gate turns that into an explicit
-- `unsupported_form_version` telling the app it is out of date — which is the
-- whole reason the gate exists.
--
-- Runtime availability is the intersection of this row and the code handler
-- (services/serviceRequests/waterCheckFormSchema.ts → WATER_CHECK_FORM_VERSION).
-- They must match exactly or the gateway fail-closes the type with
-- `request_type_configuration_mismatch`, so this migration and that constant
-- ship together.
--
-- Stored requests are untouched: rows created under v1 keep
-- `submitted_payload.formVersion = 'water_check.mobile.v1'`, which is correct —
-- the payload is an immutable record of what was submitted and under which
-- contract.

BEGIN;

UPDATE public.service_request_type_config
   SET default_form_version = 'water_check.mobile.v2',
       updated_at = NOW()
 WHERE request_type = 'water_check';

DO $$
DECLARE
  current_version text;
BEGIN
  SELECT default_form_version INTO current_version
    FROM public.service_request_type_config
   WHERE request_type = 'water_check';

  IF current_version IS NULL THEN
    RAISE EXCEPTION 'water_check registry row is missing; apply migrations 355 and 379 first';
  END IF;

  IF current_version <> 'water_check.mobile.v2' THEN
    RAISE EXCEPTION 'water_check default_form_version is "%" after the bump', current_version;
  END IF;
END $$;

COMMIT;
