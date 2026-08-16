-- Device interest/request as an executable extension of the unified service_requests model.

BEGIN;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS device_request_purpose_id BIGINT,
  ADD COLUMN IF NOT EXISTS device_request_purpose_snapshot JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_requests_device_request_purpose_fkey'
       AND conrelid = 'public.service_requests'::regclass
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_device_request_purpose_fkey
      FOREIGN KEY (device_request_purpose_id)
      REFERENCES public.system_lists(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.service_request_device_interests (
  id BIGSERIAL PRIMARY KEY,
  service_request_id BIGINT NOT NULL
    REFERENCES public.service_requests(id) ON DELETE CASCADE,
  device_model_id INTEGER
    REFERENCES public.device_models(id) ON DELETE SET NULL,
  device_snapshot JSONB NOT NULL,
  selection_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_request_device_interests_order_ck CHECK (selection_order >= 0),
  CONSTRAINT service_request_device_interests_snapshot_ck CHECK (jsonb_typeof(device_snapshot) = 'object'),
  CONSTRAINT service_request_device_interests_order_unique UNIQUE (service_request_id, selection_order)
);

CREATE INDEX IF NOT EXISTS service_request_device_interests_request_idx
  ON public.service_request_device_interests(service_request_id);
CREATE INDEX IF NOT EXISTS service_request_device_interests_model_idx
  ON public.service_request_device_interests(device_model_id)
  WHERE device_model_id IS NOT NULL;

ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS requested_employee_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'open_tasks_requested_employee_fkey'
       AND conrelid = 'public.open_tasks'::regclass
  ) THEN
    ALTER TABLE public.open_tasks
      ADD CONSTRAINT open_tasks_requested_employee_fkey
      FOREIGN KEY (requested_employee_id)
      REFERENCES public.employees(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS open_tasks_requested_employee_idx
  ON public.open_tasks(requested_employee_id)
  WHERE requested_employee_id IS NOT NULL;

INSERT INTO public.service_request_type_config (
  request_type, label_ar, description_ar, is_active, display_order,
  channels, submitter_tiers, submission_modes, default_form_version, form_source,
  external_party_policy, mismatch_policy, linkage_policy, permission_policy, audit_policy
)
VALUES (
  'device_request',
  'طلب جهاز',
  'طلب تجاري للاستفسار أو العرض أو الشراء، من موظف أو التطبيق، ضمن نموذج طلبات الخدمة الموحد.',
  TRUE,
  30,
  '["phone","internal_button","client_detail_button","admin_manual","mobile_app"]'::jsonb,
  '["staff","unverified","visitor","customer"]'::jsonb,
  '["for_self","for_another"]'::jsonb,
  'device_request.mobile.v1',
  'code_seeded',
  '{"snapshotRequired":true,"keepOriginalSubmittedData":true,"automaticClientCreation":false,"unverifiedIntakeAllowed":true,"partyModel":"requester_beneficiary_optional_referrer","referrerModes":["none","requester","separate_person"]}'::jsonb,
  '{"keepSubmittedSnapshotAfterLink":true,"manualReviewWhenSubmitterUnverified":true,"purposeSnapshotImmutable":true,"deviceSelectionSnapshotsImmutable":true}'::jsonb,
  '{"linkTarget":"clients","candidateLinkAllowed":false,"beneficiaryClientRequiredForDecision":true,"branchSource":"beneficiary_client","handoffTaskType":"device_demo"}'::jsonb,
  '{"mobileIntake":"open_or_app_account","view":"service_requests.view","review":"service_requests.review","decide":"service_requests.decide","targetDomain":"open_tasks.edit"}'::jsonb,
  '{"created":"request_created","linked":"party_linked","promoted":"promoted_to_task","rejected":"rejected_decision"}'::jsonb
)
ON CONFLICT (request_type) DO UPDATE SET
  label_ar = EXCLUDED.label_ar,
  description_ar = EXCLUDED.description_ar,
  is_active = EXCLUDED.is_active,
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

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT seed.category, seed.value, TRUE, seed.display_order, seed.metadata
FROM (VALUES
  ('device_request_purpose', 'استفسار عن جهاز', 1, '{"code":"general_inquiry"}'::jsonb),
  ('device_request_purpose', 'طلب عرض جهاز', 2, '{"code":"device_demo"}'::jsonb),
  ('device_request_purpose', 'طلب عرض سعر', 3, '{"code":"price_quote"}'::jsonb),
  ('device_request_purpose', 'رغبة بالشراء', 4, '{"code":"purchase_interest"}'::jsonb),
  ('device_request_purpose', 'استشارة لاختيار جهاز', 5, '{"code":"selection_consultation"}'::jsonb),
  ('device_request_purpose', 'غرض آخر', 6, '{"code":"other"}'::jsonb)
) AS seed(category, value, display_order, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists existing
   WHERE existing.category = seed.category
     AND existing.metadata->>'code' = seed.metadata->>'code'
);

COMMENT ON COLUMN public.service_requests.device_request_purpose_snapshot IS
  'Immutable label/code snapshot captured when a device_request is submitted.';
COMMENT ON COLUMN public.open_tasks.requested_employee_id IS
  'Employee selected during request handoff; planning scope assignment remains independent.';

COMMIT;
