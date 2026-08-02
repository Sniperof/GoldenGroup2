-- 401_registry_submission_mode_vocabulary.sql
--
-- One vocabulary for submission modes in service_request_type_config.
--
-- The registry held two spellings for the same concept:
--   water_check           ["for_self","for_another"]
--   account_creation      ["self"]
--   emergency_maintenance ["self","for_another","staff_on_behalf"]
--
-- The mobile gateway normalises an incoming mode to `for_self`/`for_another`
-- and then checks membership in this column. So the day a mobile handler is
-- installed for emergency_maintenance, every for-self submission would be
-- refused with `unsupported_submission_mode` — a failure that is invisible
-- today only because the missing-handler check (501) fires first.
--
-- `for_self` wins: it is what the contract names in البند التاسع, what the
-- gateway compares against, and what the only live mobile handler declares.
-- `staff_on_behalf` is a distinct internal mode and is left untouched.
--
-- Idempotent; touches configuration only, never a submitted request.

BEGIN;

UPDATE public.service_request_type_config
   SET submission_modes = (
         SELECT COALESCE(jsonb_agg(DISTINCT CASE WHEN mode = 'self' THEN 'for_self' ELSE mode END), '[]'::jsonb)
           FROM jsonb_array_elements_text(submission_modes) AS t(mode)
       ),
       updated_at = NOW()
 WHERE submission_modes @> '["self"]'::jsonb;

-- Fail the migration rather than leave a silent mismatch behind.
DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(request_type, ', ')
    INTO offenders
    FROM public.service_request_type_config
   WHERE submission_modes @> '["self"]'::jsonb;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'submission_modes still contains the legacy value "self" for: %', offenders;
  END IF;
END $$;

COMMIT;
