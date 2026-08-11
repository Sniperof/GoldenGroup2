-- Emergency maintenance as an executable SERVICE REQUEST type.
-- Keeps intake in service_requests and enables the shared mobile gateway.

BEGIN;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS source_call_log_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS reported_device_selection VARCHAR(32),
  ADD COLUMN IF NOT EXISTS reported_device_model_id INTEGER,
  ADD COLUMN IF NOT EXISTS reported_device_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS safety_indicator_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS device_location_decision VARCHAR(40),
  ADD COLUMN IF NOT EXISTS device_location_decided_by_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS device_location_decided_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_requests_source_call_log_fkey'
       AND conrelid = 'public.service_requests'::regclass
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_source_call_log_fkey
      FOREIGN KEY (source_call_log_id)
      REFERENCES public.customer_call_logs(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_requests_reported_device_model_fkey'
       AND conrelid = 'public.service_requests'::regclass
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_reported_device_model_fkey
      FOREIGN KEY (reported_device_model_id)
      REFERENCES public.device_models(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_requests_location_decided_by_fkey'
       AND conrelid = 'public.service_requests'::regclass
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_location_decided_by_fkey
      FOREIGN KEY (device_location_decided_by_user_id)
      REFERENCES public.hr_users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_reported_device_selection_ck,
  ADD CONSTRAINT service_requests_reported_device_selection_ck
    CHECK (
      reported_device_selection IS NULL
      OR reported_device_selection IN ('registered_device', 'catalog_model', 'other')
    ),
  DROP CONSTRAINT IF EXISTS service_requests_device_location_decision_ck,
  ADD CONSTRAINT service_requests_device_location_decision_ck
    CHECK (
      device_location_decision IS NULL
      OR device_location_decision IN ('registered_location_confirmed', 'transfer_required')
    ),
  DROP CONSTRAINT IF EXISTS service_requests_safety_indicator_codes_array_ck,
  ADD CONSTRAINT service_requests_safety_indicator_codes_array_ck
    CHECK (jsonb_typeof(safety_indicator_codes) = 'array');

CREATE INDEX IF NOT EXISTS service_requests_source_call_log_idx
  ON public.service_requests(source_call_log_id)
  WHERE source_call_log_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_requests_reported_device_model_idx
  ON public.service_requests(reported_device_model_id)
  WHERE reported_device_model_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.service_request_intake_idempotency (
  id BIGSERIAL PRIMARY KEY,
  request_type VARCHAR(100) NOT NULL,
  identity_kind VARCHAR(30) NOT NULL,
  identity_key VARCHAR(255) NOT NULL,
  idempotency_key UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  service_request_id BIGINT NOT NULL
    REFERENCES public.service_requests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_request_intake_idempotency_identity_ck
    CHECK (identity_kind IN ('customer', 'visitor', 'unverified')),
  CONSTRAINT service_request_intake_idempotency_unique
    UNIQUE (request_type, identity_kind, identity_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS service_request_intake_idempotency_request_idx
  ON public.service_request_intake_idempotency(service_request_id);

CREATE TABLE IF NOT EXISTS public.service_request_mobile_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_kind VARCHAR(30) NOT NULL,
  identity_key VARCHAR(255) NOT NULL,
  media_type VARCHAR(10) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  duration_ms INTEGER,
  service_request_id BIGINT REFERENCES public.service_requests(id) ON DELETE SET NULL,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_request_mobile_uploads_identity_ck
    CHECK (identity_kind IN ('customer', 'visitor', 'unverified')),
  CONSTRAINT service_request_mobile_uploads_media_ck
    CHECK (media_type IN ('image', 'video')),
  CONSTRAINT service_request_mobile_uploads_duration_ck
    CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 8000),
  CONSTRAINT service_request_mobile_uploads_size_ck
    CHECK (byte_size > 0)
);

CREATE INDEX IF NOT EXISTS service_request_mobile_uploads_owner_idx
  ON public.service_request_mobile_uploads(identity_kind, identity_key, expires_at)
  WHERE consumed_at IS NULL;

UPDATE public.service_request_type_config
   SET description_ar = 'طلب صيانة طارئة وارد من موظف أو من تطبيق الموبايل، بحساب أو دون حساب.',
       default_form_version = 'emergency_maintenance.mobile.v1',
       channels = '["phone","internal_button","client_detail_button","admin_manual","mobile_app"]'::jsonb,
       submitter_tiers = '["staff","unverified","visitor","customer"]'::jsonb,
       submission_modes = '["for_self","for_another"]'::jsonb,
       external_party_policy = '{
         "snapshotRequired": true,
         "keepOriginalSubmittedData": true,
         "automaticClientCreation": false,
         "unverifiedIntakeAllowed": true,
         "partyModel": "requester_beneficiary_optional_referrer",
         "referrerModes": ["none","requester","separate_person"]
       }'::jsonb,
       mismatch_policy = '{
         "keepSubmittedSnapshotAfterLink": true,
         "manualReviewWhenSubmitterUnverified": true,
         "deviceLocationMustUseRegisteredLocation": true,
         "deviceTransferRequiredForLocationChange": true
       }'::jsonb,
       linkage_policy = '{
         "linkTarget": "clients",
         "candidateLinkAllowed": false,
         "beneficiaryClientRequiredForDecision": true,
         "installedDeviceRequiredForResolveAndHandoff": true,
         "structuredProblemRequiredForResolveAndHandoff": true
       }'::jsonb,
       permission_policy = '{
         "mobileIntake": "open_or_app_account",
         "view": "service_requests.view",
         "review": "service_requests.review",
         "decide": "service_requests.decide",
         "targetDomain": "open_tasks.edit",
         "externalDevice": "installed_devices.create_external",
         "activeEmergencyOverride": "service_requests.override_active_emergency"
       }'::jsonb,
       audit_policy = '{
         "created": "request_created",
         "linked": "party_linked",
         "deviceResolved": "device_linked",
         "locationDecision": "device_location_decided",
         "promoted": "promoted_to_task",
         "merged": "merged_into_existing_task",
         "rejected": "rejected_decision"
       }'::jsonb,
       updated_at = NOW()
 WHERE request_type = 'emergency_maintenance';

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('service_requests.override_active_emergency', 'service_requests', 'service_requests', 'override_active_emergency',
   'فتح مهمة صيانة طارئة مستقلة رغم وجود مهمة نشطة', 256, ARRAY['GLOBAL'])
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
VALUES
  ('emergency_maintenance_safety_indicators', 'تسرب مياه', TRUE, 1,
   '{"code":"water_leak","suggestedPriority":"High","requiresImmediateReview":true}'::jsonb),
  ('emergency_maintenance_safety_indicators', 'خطر كهربائي', TRUE, 2,
   '{"code":"electrical_hazard","suggestedPriority":"Critical","requiresImmediateReview":true}'::jsonb),
  ('emergency_maintenance_safety_indicators', 'توقف الجهاز بالكامل', TRUE, 3,
   '{"code":"device_stopped_completely","suggestedPriority":"High","requiresImmediateReview":false}'::jsonb),
  ('emergency_maintenance_safety_indicators', 'احتمال ضرر في الممتلكات', TRUE, 4,
   '{"code":"property_damage_risk","suggestedPriority":"Critical","requiresImmediateReview":true}'::jsonb),
  ('emergency_uniqueness_override_reasons', 'العطل مختلف جوهرياً ويتطلب معالجة مستقلة', TRUE, 1,
   '{"code":"materially_different_fault"}'::jsonb),
  ('emergency_uniqueness_override_reasons', 'الحاجة إلى تخصص فني مختلف', TRUE, 2,
   '{"code":"different_technical_specialty"}'::jsonb),
  ('emergency_uniqueness_override_reasons', 'الحاجة إلى تجهيزات أو توقيت مستقل', TRUE, 3,
   '{"code":"different_equipment_or_timing"}'::jsonb),
  ('emergency_maintenance_attachment_categories', 'الجهاز بشكل عام', TRUE, 1,
   '{"code":"device_overview"}'::jsonb),
  ('emergency_maintenance_attachment_categories', 'موضع العطل', TRUE, 2,
   '{"code":"fault_area"}'::jsonb),
  ('emergency_maintenance_attachment_categories', 'التوصيلات والمحيط', TRUE, 3,
   '{"code":"connections_and_surroundings"}'::jsonb),
  ('emergency_maintenance_attachment_categories', 'أخرى', TRUE, 4,
   '{"code":"other"}'::jsonb)
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN public.service_requests.reported_device_snapshot IS
  'Immutable submitter statement about the device. Operational linkage remains installed_device_id.';
COMMENT ON COLUMN public.service_requests.service_address IS
  'Immutable reported service location. Emergency open_tasks use the installed device registered location.';

COMMIT;
