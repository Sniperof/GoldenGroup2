BEGIN;

CREATE TABLE IF NOT EXISTS public.service_request_name_nomination_items (
  id BIGSERIAL PRIMARY KEY,
  service_request_id BIGINT NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  item_order INTEGER NOT NULL CHECK (item_order > 0),
  first_name TEXT NOT NULL CHECK (btrim(first_name) <> ''),
  last_name TEXT,
  primary_phone TEXT NOT NULL CHECK (btrim(primary_phone) <> ''),
  primary_phone_has_whatsapp BOOLEAN,
  secondary_phone TEXT,
  secondary_phone_has_whatsapp BOOLEAN,
  occupation TEXT,
  governorate_id INTEGER NOT NULL REFERENCES public.geo_units(id),
  region_id INTEGER REFERENCES public.geo_units(id),
  subdistrict_id INTEGER REFERENCES public.geo_units(id),
  neighborhood_id INTEGER REFERENCES public.geo_units(id),
  geo_snapshot JSONB NOT NULL CHECK (jsonb_typeof(geo_snapshot) = 'object'),
  submitted_snapshot JSONB NOT NULL CHECK (jsonb_typeof(submitted_snapshot) = 'object'),
  branch_resolution_geo_unit_id INTEGER NOT NULL REFERENCES public.geo_units(id),
  branch_resolution_status TEXT NOT NULL
    CHECK (branch_resolution_status IN ('resolved','ambiguous','no_coverage')),
  branch_resolution_reason TEXT NOT NULL,
  branch_id INTEGER REFERENCES public.branches(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','converted','skipped')),
  candidate_id BIGINT UNIQUE REFERENCES public.candidates(id),
  exclusion_reason_id INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  exclusion_reason_snapshot JSONB,
  decided_by_user_id BIGINT REFERENCES public.hr_users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_request_id, item_order),
  CHECK (secondary_phone IS NOT NULL OR secondary_phone_has_whatsapp IS NULL),
  CHECK ((branch_resolution_status = 'resolved') = (branch_id IS NOT NULL)),
  CHECK (
    (status = 'pending' AND candidate_id IS NULL AND exclusion_reason_snapshot IS NULL AND decided_at IS NULL)
    OR (status = 'converted' AND candidate_id IS NOT NULL AND exclusion_reason_snapshot IS NULL AND decided_at IS NOT NULL)
    OR (status = 'skipped' AND candidate_id IS NULL AND exclusion_reason_snapshot IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS service_request_name_nomination_items_request_idx
  ON public.service_request_name_nomination_items(service_request_id, status, item_order);

ALTER TABLE public.service_request_audit_log
  DROP CONSTRAINT IF EXISTS service_request_audit_log_event_type_check;
ALTER TABLE public.service_request_audit_log
  ADD CONSTRAINT service_request_audit_log_event_type_check CHECK (event_type IN (
    'request_created','status_changed','claimed_by_operator','claim_transferred','review_required_flag_set',
    'duplicate_flag_set','party_linked','linkage_changed','candidate_created','priority_changed',
    'escalated_to_audit_admin','escalation_resolved','rejected_decision','promoted_to_task','request_completed',
    'merged_into_existing_task','cancelled_by_admin','customer_info_requested','customer_info_received',
    'internal_note_added','archived','unarchived','request_reopened','problem_added','problem_edited',
    'problem_status_changed','problem_resolution_recorded','problem_soft_deleted','problem_restored',
    'problem_audit_admin_override','name_nomination_item_converted','name_nomination_item_skipped',
    'name_nomination_completed'
  ));

INSERT INTO public.service_request_type_config (
  request_type, label_ar, description_ar, is_active, display_order,
  channels, submitter_tiers, submission_modes, default_form_version, form_source,
  external_party_policy, mismatch_policy, linkage_policy, permission_policy, audit_policy
) VALUES (
  'name_nomination', 'طلب ترشيح أسماء',
  'طلب جوال لترشيح أسماء مقترحة؛ مقدم الطلب هو الوسيط لكل اسم وتتم المراجعة مركزياً.',
  TRUE, 27, '["mobile_app"]'::jsonb,
  '["unverified","visitor","customer"]'::jsonb, '["nomination"]'::jsonb,
  'name_nomination.mobile.v1', 'code_seeded',
  '{"snapshotRequired":true,"requesterIsMediator":true,"unverifiedIntakeAllowed":true,"forAnotherMode":false}'::jsonb,
  '{"submittedNamesImmutable":true,"duplicatePhonesAllowed":true,"perItemBranchResolution":true}'::jsonb,
  '{"linkTarget":"candidates","multiTarget":true,"candidateStatus":"Suggested","candidateOwnership":"BRANCH","openTaskCreated":false}'::jsonb,
  '{"mobileIntake":"open_or_app_account","view":"name_nomination.view","review":"name_nomination.review","decide":"name_nomination.decide","resolve_escalation":"name_nomination.resolve_escalation","archive":"name_nomination.archive","targetDomain":"candidates.create","requiredScope":"GLOBAL"}'::jsonb,
  '{"created":"request_created","itemConverted":"name_nomination_item_converted","itemSkipped":"name_nomination_item_skipped","completed":"name_nomination_completed"}'::jsonb
)
ON CONFLICT (request_type) DO UPDATE SET
  label_ar=EXCLUDED.label_ar, description_ar=EXCLUDED.description_ar, is_active=EXCLUDED.is_active,
  display_order=EXCLUDED.display_order, channels=EXCLUDED.channels, submitter_tiers=EXCLUDED.submitter_tiers,
  submission_modes=EXCLUDED.submission_modes, default_form_version=EXCLUDED.default_form_version,
  form_source=EXCLUDED.form_source, external_party_policy=EXCLUDED.external_party_policy,
  mismatch_policy=EXCLUDED.mismatch_policy, linkage_policy=EXCLUDED.linkage_policy,
  permission_policy=EXCLUDED.permission_policy, audit_policy=EXCLUDED.audit_policy, updated_at=NOW();

INSERT INTO public.permissions (key,module,sub_module,action,display_name,display_order,allowed_scopes)
VALUES
 ('name_nomination.view','name_nomination','service_requests','view','عرض طلبات ترشيح الأسماء',292,ARRAY['GLOBAL']),
 ('name_nomination.review','name_nomination','service_requests','review','مراجعة طلبات ترشيح الأسماء',293,ARRAY['GLOBAL']),
 ('name_nomination.decide','name_nomination','service_requests','decide','حسم طلبات ترشيح الأسماء',294,ARRAY['GLOBAL']),
 ('name_nomination.resolve_escalation','name_nomination','service_requests','resolve_escalation','فك تصعيد طلبات ترشيح الأسماء',295,ARRAY['GLOBAL']),
 ('name_nomination.archive','name_nomination','service_requests','archive','أرشفة طلبات ترشيح الأسماء',296,ARRAY['GLOBAL'])
ON CONFLICT (key) DO UPDATE SET module=EXCLUDED.module, sub_module=EXCLUDED.sub_module,
 action=EXCLUDED.action, display_name=EXCLUDED.display_name, display_order=EXCLUDED.display_order,
 allowed_scopes=EXCLUDED.allowed_scopes;

INSERT INTO public.system_settings (key,value,value_type,category,description,is_editable,updated_at)
VALUES
 ('name_nomination_max_names_per_request','50','integer','service_requests','الحد الأقصى للأسماء في طلب ترشيح واحد',TRUE,NOW()),
 ('name_nomination_daily_per_identity','5','integer','service_requests','السقف اليومي لطلبات ترشيح الأسماء لكل هوية أو جهاز',TRUE,NOW()),
 ('name_nomination_daily_per_unverified_ip','20','integer','service_requests','السقف اليومي لطلبات ترشيح الأسماء لكل IP للأجهزة غير الموثقة',TRUE,NOW())
ON CONFLICT (key) DO UPDATE SET value_type=EXCLUDED.value_type, category=EXCLUDED.category,
 description=EXCLUDED.description, is_editable=EXCLUDED.is_editable, updated_at=NOW();

INSERT INTO public.system_lists (category,value,is_active,display_order,metadata)
SELECT seed.category, seed.value, TRUE, seed.display_order, seed.metadata
FROM (VALUES
 ('name_nomination_item_exclusion_reasons','بيانات الاسم غير مكتملة أو غير صالحة',10,'{"code":"invalid_or_incomplete_data"}'::jsonb),
 ('name_nomination_item_exclusion_reasons','الاسم خارج نطاق العمل',20,'{"code":"out_of_scope"}'::jsonb),
 ('name_nomination_item_exclusion_reasons','استبعاد إداري موثق',30,'{"code":"administrative_exclusion"}'::jsonb),
 ('service_request_rejection_name_nomination','تعذر التحقق من هوية مقدم الطلب',10,'{"code":"requester_identity_unverified"}'::jsonb),
 ('service_request_rejection_name_nomination','اشتباه بإساءة استخدام أو احتيال',20,'{"code":"fraud_or_abuse_suspected"}'::jsonb),
 ('service_request_rejection_name_nomination','بيانات الطلب غير صالحة أو مضللة',30,'{"code":"invalid_or_misleading_data"}'::jsonb)
) seed(category,value,display_order,metadata)
WHERE NOT EXISTS (SELECT 1 FROM public.system_lists x WHERE x.category=seed.category AND x.metadata->>'code'=seed.metadata->>'code');

COMMENT ON TABLE public.service_request_name_nomination_items IS
  'Immutable submitted names with independent central-review decisions and per-item branch ownership.';

COMMIT;
