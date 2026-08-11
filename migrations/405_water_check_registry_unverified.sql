-- DEC-016 — registry row for water_check after OTP removal.
--
-- Two coupled changes that MUST land together with the code, because the
-- gateway refuses the type when the registry's form version and the installed
-- handler disagree (`request_type_configuration_mismatch`, fail-closed):
--   1. `unverified` joins the accepted submitter tiers (D-WC2).
--   2. the unreleased v3 contract separates requester, beneficiary, and the
--      optional mediator through referrerMode (D-WC7).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.service_request_type_config WHERE request_type = 'water_check'
  ) THEN
    RAISE EXCEPTION 'water_check registry row is missing; apply migration 355 first';
  END IF;
END $$;

UPDATE public.service_request_type_config
   SET description_ar = 'طلب وارد من تطبيق الموبايل لفحص المياه، من زائر بلا تحقق أو زبون مسجل.',
       default_form_version = 'water_check.mobile.v3',
       submitter_tiers = '["unverified","visitor","customer"]'::jsonb,
       external_party_policy = '{
         "snapshotRequired": true,
         "keepOriginalSubmittedData": true,
         "visitorVerificationPurpose": null,
         "authenticatedRequesterSource": "app_account",
         "automaticClientCreation": false,
         "unverifiedIntakeAllowed": true,
         "unverifiedRequesterIdentity": "device_fingerprint",
         "partyModel": "requester_beneficiary_optional_referrer",
         "referrerModes": ["none","requester","separate_person"],
         "registeredReferrerModes": ["none","requester"],
         "registeredSecondaryContactRequestOverride": true
       }'::jsonb,
       mismatch_policy = '{
         "manualReviewWhenBranchUnresolved": true,
         "keepSubmittedSnapshotAfterLink": true,
         "manualReviewWhenSubmitterUnverified": true,
         "manualReviewWhenBeneficiaryPhoneRepeats": true
       }'::jsonb,
       permission_policy = '{
         "mobileIntake": "open_or_app_account",
         "view": "service_requests.view",
         "review": "service_requests.review",
         "handoff": "service_requests.promote"
       }'::jsonb,
       updated_at = NOW()
 WHERE request_type = 'water_check';

COMMIT;
