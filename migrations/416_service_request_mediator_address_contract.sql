-- A mediator now carries an independently submitted SmartGeo address snapshot.
-- The three administrative levels are newly required, so every affected mobile
-- form receives a new version instead of silently changing an existing contract.

BEGIN;

UPDATE public.service_request_type_config
SET default_form_version = CASE request_type
      WHEN 'water_check' THEN 'water_check.mobile.v4'
      WHEN 'emergency_maintenance' THEN 'emergency_maintenance.mobile.v2'
      WHEN 'periodic_maintenance' THEN 'periodic_maintenance.mobile.v2'
      WHEN 'device_request' THEN 'device_request.mobile.v2'
    END,
    external_party_policy = COALESCE(external_party_policy, '{}'::jsonb) ||
      '{"mediatorAddress":{"requiredWhenReferrerExists":true,"requiredLevels":["governorate","cityOrArea","subArea"],"optionalFields":["neighborhood","detailedAddress","mapLocation"],"validator":"SmartGeo"}}'::jsonb,
    updated_at = NOW()
WHERE request_type IN (
  'water_check',
  'emergency_maintenance',
  'periodic_maintenance',
  'device_request'
);

DO $$
DECLARE
  affected_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO affected_count
  FROM public.service_request_type_config
  WHERE (request_type = 'water_check' AND default_form_version = 'water_check.mobile.v4')
     OR (request_type = 'emergency_maintenance' AND default_form_version = 'emergency_maintenance.mobile.v2')
     OR (request_type = 'periodic_maintenance' AND default_form_version = 'periodic_maintenance.mobile.v2')
     OR (request_type = 'device_request' AND default_form_version = 'device_request.mobile.v2');

  IF affected_count <> 4 THEN
    RAISE EXCEPTION 'mediator address contract expected four configured request types, found %', affected_count;
  END IF;
END $$;

COMMIT;
