-- Golden-warranty requests are review-gated intake records. They lock the
-- requested period, but pricing and activation remain owned by the offer task.

BEGIN;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS requested_warranty_months INTEGER,
  ADD COLUMN IF NOT EXISTS requested_warranty_period_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS beneficiary_contact_consent_confirmed BOOLEAN;

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_requested_warranty_months_ck,
  ADD CONSTRAINT service_requests_requested_warranty_months_ck
    CHECK (requested_warranty_months IS NULL OR requested_warranty_months > 0),
  DROP CONSTRAINT IF EXISTS service_requests_requested_warranty_period_snapshot_ck,
  ADD CONSTRAINT service_requests_requested_warranty_period_snapshot_ck
    CHECK (
      requested_warranty_period_snapshot IS NULL
      OR jsonb_typeof(requested_warranty_period_snapshot) = 'object'
    );

CREATE UNIQUE INDEX IF NOT EXISTS open_tasks_unique_golden_warranty_source_request
  ON public.open_tasks(source_service_request_id)
  WHERE task_type = 'golden_warranty_offer'
    AND source_service_request_id IS NOT NULL;

ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_creation_origin_check,
  ADD CONSTRAINT open_tasks_creation_origin_check
    CHECK (
      creation_origin IS NULL OR creation_origin IN (
        'branch_plan', 'service_request_call', 'telemarketing_inline_booking',
        'cascading_during_visit', 'manual_creation', 'emergency_request',
        'periodic_request', 'golden_warranty_request', 'system_trigger'
      )
    );

INSERT INTO public.service_request_type_config (
  request_type, label_ar, description_ar, is_active, display_order,
  channels, submitter_tiers, submission_modes, default_form_version, form_source,
  external_party_policy, mismatch_policy, linkage_policy, permission_policy, audit_policy
)
VALUES (
  'golden_warranty',
  'طلب كفالة ذهبية',
  'طلب مراجعة لإنشاء مهمة عرض كفالة ذهبية لجهاز واحد ومدة مقفلة دون تسعير أو تفعيل مباشر.',
  TRUE,
  26,
  '["phone","mobile_app"]'::jsonb,
  '["staff","unverified","visitor","customer"]'::jsonb,
  '["for_self","for_another"]'::jsonb,
  'golden_warranty.mobile.v1',
  'code_seeded',
  '{"snapshotRequired":true,"keepOriginalSubmittedData":true,"automaticClientCreation":false,"unverifiedIntakeAllowed":true,"partyModel":"requester_beneficiary","requesterIsNotReferrer":true,"beneficiaryContactConsentRequired":true}'::jsonb,
  '{"keepSubmittedSnapshotAfterLink":true,"manualReviewWhenSubmitterUnverified":true,"reportedDeviceImmutable":true,"requestedWarrantyPeriodImmutable":true,"priceExcludedFromRequest":true}'::jsonb,
  '{"linkTarget":"clients","candidateLinkAllowed":false,"beneficiaryClientRequiredForHandoff":true,"installedDeviceRequiredForHandoff":true,"handoffTaskType":"golden_warranty_offer","activeWarrantyPolicy":"resolve_at_intake","activeOfferTaskPolicy":"resolve_at_intake","taskOutcomeChangesRequest":false}'::jsonb,
  '{"mobileIntake":"open_or_app_account","view":"golden_warranty.view","review":"golden_warranty.review","decide":"golden_warranty.decide","resolve_escalation":"golden_warranty.resolve_escalation","archive":"golden_warranty.archive","create":"golden_warranty.create","targetDomain":"open_tasks.edit"}'::jsonb,
  '{"created":"request_created","linked":"party_linked","deviceResolved":"device_linked","promoted":"promoted_to_task","resolved":"resolved_at_intake","rejected":"rejected_decision"}'::jsonb
)
ON CONFLICT (request_type) DO UPDATE SET
  label_ar = EXCLUDED.label_ar,
  description_ar = EXCLUDED.description_ar,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  channels = EXCLUDED.channels,
  submitter_tiers = EXCLUDED.submitter_tiers,
  submission_modes = EXCLUDED.submission_modes,
  default_form_version = EXCLUDED.default_form_version,
  form_source = EXCLUDED.form_source,
  external_party_policy = EXCLUDED.external_party_policy,
  mismatch_policy = EXCLUDED.mismatch_policy,
  linkage_policy = EXCLUDED.linkage_policy,
  permission_policy = EXCLUDED.permission_policy,
  audit_policy = EXCLUDED.audit_policy,
  updated_at = NOW();

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('golden_warranty.view', 'golden_warranty', 'service_requests', 'view',
   'عرض طلبات الكفالة الذهبية', 286, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('golden_warranty.review', 'golden_warranty', 'service_requests', 'review',
   'مراجعة وربط طلبات الكفالة الذهبية', 287, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('golden_warranty.decide', 'golden_warranty', 'service_requests', 'decide',
   'حسم طلبات الكفالة الذهبية', 288, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('golden_warranty.resolve_escalation', 'golden_warranty', 'service_requests', 'resolve_escalation',
   'فك تصعيد طلبات الكفالة الذهبية', 289, ARRAY['GLOBAL','BRANCH']),
  ('golden_warranty.archive', 'golden_warranty', 'service_requests', 'archive',
   'أرشفة طلبات الكفالة الذهبية', 290, ARRAY['GLOBAL','BRANCH']),
  ('golden_warranty.create', 'golden_warranty', 'service_requests', 'create',
   'إنشاء طلب كفالة ذهبية من نتيجة اتصال', 291, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

WITH eligible_roles AS (
  SELECT first_grant.role_id,
         CASE
           WHEN first_grant.scope_type = 'GLOBAL' AND second_grant.scope_type = 'GLOBAL' THEN 'GLOBAL'
           ELSE 'BRANCH'
         END AS scope_type
    FROM public.role_permission_grants first_grant
    JOIN public.permissions first_permission
      ON first_permission.id = first_grant.permission_id
     AND first_permission.key = 'telemarketing.calls.create'
    JOIN public.role_permission_grants second_grant
      ON second_grant.role_id = first_grant.role_id
    JOIN public.permissions second_permission
      ON second_permission.id = second_grant.permission_id
     AND second_permission.key = 'service_requests.create'
), target_permission AS (
  SELECT id AS permission_id FROM public.permissions WHERE key = 'golden_warranty.create'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT eligible_roles.role_id, target_permission.permission_id, eligible_roles.scope_type
  FROM eligible_roles CROSS JOIN target_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT seed.category, seed.value, TRUE, seed.display_order, seed.metadata
FROM (VALUES
  ('service_request_resolve_at_intake_golden_warranty', 'توجد كفالة عقد فعالة للجهاز', 10, '{"code":"active_contract_warranty_exists"}'::jsonb),
  ('service_request_resolve_at_intake_golden_warranty', 'توجد كفالة ذهبية فعالة للجهاز', 20, '{"code":"active_golden_warranty_exists"}'::jsonb),
  ('service_request_resolve_at_intake_golden_warranty', 'توجد مهمة عرض كفالة ذهبية فعالة للجهاز', 30, '{"code":"active_golden_warranty_offer_exists"}'::jsonb),
  ('service_request_resolve_at_intake_golden_warranty', 'الجهاز غير فعال', 40, '{"code":"device_not_active"}'::jsonb),
  ('service_request_resolve_at_intake_golden_warranty', 'طراز الجهاز لا يدعم الكفالة الذهبية', 50, '{"code":"device_model_not_golden_warranty_eligible"}'::jsonb),
  ('service_request_resolve_at_intake_golden_warranty', 'لا يوجد جهاز مركب مؤهل للمستفيد', 60, '{"code":"no_eligible_installed_device"}'::jsonb),
  ('service_request_resolve_at_intake_golden_warranty', 'الجهاز المرتبط لا يدعم المدة المطلوبة', 70, '{"code":"linked_device_does_not_support_requested_period"}'::jsonb),
  ('service_request_resolve_at_intake_golden_warranty', 'المدة المطلوبة لم تعد متاحة', 80, '{"code":"requested_period_no_longer_available"}'::jsonb),
  ('service_request_resolve_at_intake_golden_warranty', 'سحب مقدم الطلب طلبه قبل إنشاء المهمة', 90, '{"code":"requester_withdrew_before_handoff"}'::jsonb),
  ('service_request_resolve_at_intake_golden_warranty', 'تم تقديم الإرشاد دون طلب عرض كفالة', 100, '{"code":"guidance_only_no_offer_requested"}'::jsonb),
  ('service_request_rejection_golden_warranty', 'تعذر التحقق من هوية المستفيد', 10, '{"code":"beneficiary_identity_could_not_be_verified"}'::jsonb),
  ('service_request_rejection_golden_warranty', 'اشتباه باحتيال أو إساءة استخدام', 20, '{"code":"fraud_or_abuse_suspected"}'::jsonb),
  ('service_request_rejection_golden_warranty', 'بيانات مقدمة غير صحيحة أو مضللة', 30, '{"code":"invalid_or_misleading_submitted_data"}'::jsonb),
  ('service_request_rejection_golden_warranty', 'تعذر استكمال المعلومات المطلوبة', 40, '{"code":"unable_to_complete_required_information"}'::jsonb)
) AS seed(category, value, display_order, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists existing
   WHERE existing.category = seed.category
     AND existing.metadata->>'code' = seed.metadata->>'code'
);

COMMENT ON COLUMN public.service_requests.requested_warranty_period_snapshot IS
  'Immutable months/label snapshot selected from the submitted device model.';
COMMENT ON COLUMN public.service_requests.beneficiary_contact_consent_confirmed IS
  'Requester attestation that the beneficiary may be contacted about this request.';

COMMIT;
