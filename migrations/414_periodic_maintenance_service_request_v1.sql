-- Periodic maintenance as a review-gated service request.
-- A request may create one NEW periodic task; it never reschedules an active task.

BEGIN;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS periodic_maintenance_reason_id BIGINT,
  ADD COLUMN IF NOT EXISTS periodic_maintenance_reason_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS decision_reason_id BIGINT,
  ADD COLUMN IF NOT EXISTS decision_reason_snapshot JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_requests_periodic_reason_fkey'
       AND conrelid = 'public.service_requests'::regclass
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_periodic_reason_fkey
      FOREIGN KEY (periodic_maintenance_reason_id)
      REFERENCES public.system_lists(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_requests_decision_reason_fkey'
       AND conrelid = 'public.service_requests'::regclass
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_decision_reason_fkey
      FOREIGN KEY (decision_reason_id)
      REFERENCES public.system_lists(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_periodic_reason_snapshot_ck,
  ADD CONSTRAINT service_requests_periodic_reason_snapshot_ck
    CHECK (
      periodic_maintenance_reason_snapshot IS NULL
      OR jsonb_typeof(periodic_maintenance_reason_snapshot) = 'object'
    ),
  DROP CONSTRAINT IF EXISTS service_requests_decision_reason_snapshot_ck,
  ADD CONSTRAINT service_requests_decision_reason_snapshot_ck
    CHECK (
      decision_reason_snapshot IS NULL
      OR jsonb_typeof(decision_reason_snapshot) = 'object'
    );

CREATE INDEX IF NOT EXISTS service_requests_periodic_reason_idx
  ON public.service_requests(periodic_maintenance_reason_id)
  WHERE periodic_maintenance_reason_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS service_requests_unique_active_periodic_per_device
  ON public.service_requests(installed_device_id)
  WHERE request_type = 'periodic_maintenance'
    AND installed_device_id IS NOT NULL
    AND status IN ('received', 'in_review');

CREATE UNIQUE INDEX IF NOT EXISTS open_tasks_unique_periodic_source_request
  ON public.open_tasks(source_service_request_id)
  WHERE task_type = 'periodic_maintenance'
    AND source_service_request_id IS NOT NULL;

ALTER TABLE public.open_task_periodic_payload
  ADD COLUMN IF NOT EXISTS request_reason_id BIGINT,
  ADD COLUMN IF NOT EXISTS request_reason_snapshot JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'open_task_periodic_payload_request_reason_fkey'
       AND conrelid = 'public.open_task_periodic_payload'::regclass
  ) THEN
    ALTER TABLE public.open_task_periodic_payload
      ADD CONSTRAINT open_task_periodic_payload_request_reason_fkey
      FOREIGN KEY (request_reason_id)
      REFERENCES public.system_lists(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE public.open_task_periodic_payload
  DROP CONSTRAINT IF EXISTS open_task_periodic_payload_generation_origin_check,
  ADD CONSTRAINT open_task_periodic_payload_generation_origin_check
    CHECK (generation_origin IN ('system', 'manual', 'service_request')),
  DROP CONSTRAINT IF EXISTS open_task_periodic_payload_request_reason_snapshot_ck,
  ADD CONSTRAINT open_task_periodic_payload_request_reason_snapshot_ck
    CHECK (
      request_reason_snapshot IS NULL
      OR jsonb_typeof(request_reason_snapshot) = 'object'
    );

ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_creation_origin_check,
  ADD CONSTRAINT open_tasks_creation_origin_check
    CHECK (
      creation_origin IS NULL OR creation_origin IN (
        'branch_plan', 'service_request_call', 'telemarketing_inline_booking',
        'cascading_during_visit', 'manual_creation', 'emergency_request',
        'periodic_request', 'system_trigger'
      )
    );

INSERT INTO public.service_request_type_config (
  request_type, label_ar, description_ar, is_active, display_order,
  channels, submitter_tiers, submission_modes, default_form_version, form_source,
  external_party_policy, mismatch_policy, linkage_policy, permission_policy, audit_policy
)
VALUES (
  'periodic_maintenance',
  'طلب صيانة دورية',
  'طلب مراجعة لإنشاء مهمة صيانة دورية جديدة لجهاز محدد دون تعديل أو إعادة جدولة مهمة دورية قائمة.',
  TRUE,
  25,
  '["phone","mobile_app"]'::jsonb,
  '["staff","unverified","visitor","customer"]'::jsonb,
  '["for_self","for_another"]'::jsonb,
  'periodic_maintenance.mobile.v1',
  'code_seeded',
  '{"snapshotRequired":true,"keepOriginalSubmittedData":true,"automaticClientCreation":false,"unverifiedIntakeAllowed":true,"partyModel":"requester_beneficiary_optional_referrer","referrerModes":["none","requester","separate_person"]}'::jsonb,
  '{"keepSubmittedSnapshotAfterLink":true,"manualReviewWhenSubmitterUnverified":true,"reportedDeviceImmutable":true,"serialIsMatchingEvidenceOnly":true,"deviceLocationMustUseRegisteredLocation":true,"deviceTransferRequiredForLocationChange":true}'::jsonb,
  '{"linkTarget":"clients","candidateLinkAllowed":false,"beneficiaryClientRequiredForDecision":true,"installedDeviceRequiredForResolveAndHandoff":true,"handoffTaskType":"periodic_maintenance","activeTaskPolicy":"resolve_at_intake","rescheduleAllowed":false}'::jsonb,
  '{"mobileIntake":"open_or_app_account","view":"periodic_maintenance.view","review":"periodic_maintenance.review","decide":"periodic_maintenance.decide","resolve_escalation":"periodic_maintenance.resolve_escalation","archive":"periodic_maintenance.archive","create":"periodic_maintenance.create"}'::jsonb,
  '{"created":"request_created","linked":"party_linked","deviceResolved":"device_linked","locationDecision":"device_location_decided","promoted":"promoted_to_task","resolved":"resolved_at_intake","rejected":"rejected_decision"}'::jsonb
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
  ('periodic_maintenance.view', 'periodic_maintenance', 'service_requests', 'view',
   'عرض طلبات الصيانة الدورية', 280, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('periodic_maintenance.review', 'periodic_maintenance', 'service_requests', 'review',
   'مراجعة وربط طلبات الصيانة الدورية', 281, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('periodic_maintenance.decide', 'periodic_maintenance', 'service_requests', 'decide',
   'حسم طلبات الصيانة الدورية', 282, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('periodic_maintenance.resolve_escalation', 'periodic_maintenance', 'service_requests', 'resolve_escalation',
   'فك تصعيد طلبات الصيانة الدورية', 283, ARRAY['GLOBAL','BRANCH']),
  ('periodic_maintenance.archive', 'periodic_maintenance', 'service_requests', 'archive',
   'أرشفة طلبات الصيانة الدورية', 284, ARRAY['GLOBAL','BRANCH']),
  ('periodic_maintenance.create', 'periodic_maintenance', 'service_requests', 'create',
   'إنشاء طلب صيانة دورية من نتيجة اتصال', 285, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

-- Staff who can currently record a service-request call may create the new
-- request type, but receive no review/view/decision access implicitly.
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
  SELECT id AS permission_id FROM public.permissions
   WHERE key = 'periodic_maintenance.create'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT eligible_roles.role_id, target_permission.permission_id, eligible_roles.scope_type
  FROM eligible_roles CROSS JOIN target_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT seed.category, seed.value, TRUE, seed.display_order, seed.metadata
FROM (VALUES
  ('periodic_maintenance_request_reasons', 'طلب إجراء الصيانة الدورية المستحقة', 10, '{"code":"scheduled_service_requested"}'::jsonb),
  ('service_request_resolve_at_intake_periodic_maintenance', 'توجد مهمة صيانة دورية نشطة للجهاز', 10, '{"code":"active_periodic_task_exists"}'::jsonb),
  ('service_request_rejection_periodic_maintenance', 'تعذر تحديد الجهاز المقصود', 10, '{"code":"device_could_not_be_identified"}'::jsonb),
  ('service_request_rejection_periodic_maintenance', 'الجهاز غير تابع للمستفيد', 20, '{"code":"device_not_owned_by_beneficiary"}'::jsonb),
  ('service_request_rejection_periodic_maintenance', 'الجهاز غير فعال', 30, '{"code":"device_inactive"}'::jsonb),
  ('service_request_rejection_periodic_maintenance', 'لا توجد تغطية صيانة دورية فعالة', 40, '{"code":"periodic_service_coverage_unavailable"}'::jsonb),
  ('service_request_rejection_periodic_maintenance', 'لم تعتمد خدمة الجهاز الخارجي', 50, '{"code":"external_device_service_not_approved"}'::jsonb),
  ('service_request_rejection_periodic_maintenance', 'موقع الخدمة غير مدعوم', 60, '{"code":"service_location_not_supported"}'::jsonb),
  ('service_request_rejection_periodic_maintenance', 'الطلب خارج نطاق الخدمة', 70, '{"code":"request_out_of_scope"}'::jsonb),
  ('service_request_rejection_periodic_maintenance', 'طلب غير صالح', 80, '{"code":"invalid_request"}'::jsonb),
  ('service_request_rejection_periodic_maintenance', 'طلب مزعج أو آلي', 90, '{"code":"spam"}'::jsonb),
  ('service_request_rejection_periodic_maintenance', 'تعذر التحقق من المتصل', 100, '{"code":"unverified_caller"}'::jsonb)
) AS seed(category, value, display_order, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists existing
   WHERE existing.category = seed.category
     AND existing.metadata->>'code' = seed.metadata->>'code'
);

COMMENT ON COLUMN public.service_requests.periodic_maintenance_reason_snapshot IS
  'Immutable id/code/label snapshot selected by the periodic-maintenance request creator.';
COMMENT ON COLUMN public.service_requests.decision_reason_snapshot IS
  'Immutable id/code/label snapshot selected for a list-driven terminal decision.';
COMMENT ON COLUMN public.open_task_periodic_payload.request_reason_snapshot IS
  'Immutable periodic service-request reason copied into the generated task payload.';

COMMIT;
