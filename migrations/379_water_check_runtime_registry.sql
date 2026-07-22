-- Makes the existing water_check registry row usable by the runtime mobile
-- intake gateway. Runtime availability is the intersection of this row and a
-- code-installed handler with the exact same form version.

BEGIN;

UPDATE public.service_request_type_config
   SET label_ar = 'طلب فحص المياه',
       description_ar = 'طلب وارد من تطبيق الموبايل لفحص المياه، من زائر موثق بالرمز أو زبون مسجل.',
       is_active = TRUE,
       display_order = 10,
       default_form_version = 'water_check.mobile.v1',
       form_source = 'code_seeded',
       channels = '["mobile_app"]'::jsonb,
       submitter_tiers = '["visitor","customer"]'::jsonb,
       submission_modes = '["for_self","for_another"]'::jsonb,
       external_party_policy = '{
         "snapshotRequired": true,
         "keepOriginalSubmittedData": true,
         "visitorVerificationPurpose": "service_request",
         "authenticatedRequesterSource": "app_account",
         "automaticClientCreation": false
       }'::jsonb,
       mismatch_policy = '{
         "manualReviewWhenBranchUnresolved": true,
         "keepSubmittedSnapshotAfterLink": true
       }'::jsonb,
       linkage_policy = '{
         "beneficiaryLinkTarget": "clients",
         "referrerLinkTarget": "clients",
         "candidateLinkAllowed": false,
         "requiredBeforeHandoff": ["beneficiary_client"]
       }'::jsonb,
       permission_policy = '{
         "mobileIntake": "visitor_otp_or_app_account",
         "view": "service_requests.view",
         "review": "service_requests.review",
         "handoff": "service_requests.promote"
       }'::jsonb,
       audit_policy = '{
         "created": "request_created",
         "linked": "party_linked",
         "handoff": "promoted_to_task"
       }'::jsonb,
       updated_at = NOW()
 WHERE request_type = 'water_check';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.service_request_type_config WHERE request_type = 'water_check'
  ) THEN
    RAISE EXCEPTION 'water_check registry row is missing; apply migration 355 first';
  END IF;
END $$;

COMMIT;
