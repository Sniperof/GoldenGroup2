BEGIN;

ALTER TABLE public.service_request_mobile_uploads
  DROP CONSTRAINT IF EXISTS service_request_mobile_uploads_media_ck,
  ADD CONSTRAINT service_request_mobile_uploads_media_ck
    CHECK (media_type IN ('image','video','document'));

INSERT INTO public.service_request_type_config (
  request_type,label_ar,description_ar,is_active,display_order,channels,submitter_tiers,
  submission_modes,default_form_version,form_source,external_party_policy,mismatch_policy,
  linkage_policy,permission_policy,audit_policy
) VALUES (
  'agent_license','طلب ترخيص وكيل',
  'طلب جوال للنفس يخضع لمراجعة مركزية وينتهي بالموافقة أو الرفض دون إنشاء مهمة أو ترخيص تشغيلي مستقل.',
  TRUE,28,'["mobile_app"]'::jsonb,'["unverified","visitor","customer"]'::jsonb,
  '["self_only"]'::jsonb,'agent_license.mobile.v1','code_seeded',
  '{"snapshotRequired":true,"partyRole":"applicant","selfOnly":true,"automaticClientCreation":false,"optionalClientLink":true,"unverifiedIntakeAllowed":true}'::jsonb,
  '{"primaryPhoneOpenRequestLimit":1,"otherDuplicatesReviewOnly":true,"optionalNationalId":true}'::jsonb,
  '{"linkTarget":"clients","linkOptional":true,"downstreamEntity":null,"terminalSuccess":"completed","resolvedAtIntakeExposed":false,"reopenAllowed":false}'::jsonb,
  '{"mobileIntake":"open_or_app_account","view":"agent_license.view","review":"agent_license.review","decide":"agent_license.decide","resolve_escalation":"agent_license.resolve_escalation","archive":"agent_license.archive","requiredScope":"GLOBAL"}'::jsonb,
  '{"created":"request_created","approved":"request_completed","rejected":"rejected_decision"}'::jsonb
) ON CONFLICT (request_type) DO UPDATE SET
  label_ar=EXCLUDED.label_ar,description_ar=EXCLUDED.description_ar,is_active=EXCLUDED.is_active,
  display_order=EXCLUDED.display_order,channels=EXCLUDED.channels,submitter_tiers=EXCLUDED.submitter_tiers,
  submission_modes=EXCLUDED.submission_modes,default_form_version=EXCLUDED.default_form_version,
  form_source=EXCLUDED.form_source,external_party_policy=EXCLUDED.external_party_policy,
  mismatch_policy=EXCLUDED.mismatch_policy,linkage_policy=EXCLUDED.linkage_policy,
  permission_policy=EXCLUDED.permission_policy,audit_policy=EXCLUDED.audit_policy,updated_at=NOW();

INSERT INTO public.permissions (key,module,sub_module,action,display_name,display_order,allowed_scopes)
VALUES
 ('agent_license.view','agent_license','service_requests','view','عرض طلبات ترخيص الوكلاء',297,ARRAY['GLOBAL']),
 ('agent_license.review','agent_license','service_requests','review','مراجعة وربط طلبات ترخيص الوكلاء',298,ARRAY['GLOBAL']),
 ('agent_license.decide','agent_license','service_requests','decide','حسم طلبات ترخيص الوكلاء',299,ARRAY['GLOBAL']),
 ('agent_license.resolve_escalation','agent_license','service_requests','resolve_escalation','فك تصعيد طلبات ترخيص الوكلاء',300,ARRAY['GLOBAL']),
 ('agent_license.archive','agent_license','service_requests','archive','أرشفة طلبات ترخيص الوكلاء',301,ARRAY['GLOBAL'])
ON CONFLICT (key) DO UPDATE SET module=EXCLUDED.module,sub_module=EXCLUDED.sub_module,
 action=EXCLUDED.action,display_name=EXCLUDED.display_name,display_order=EXCLUDED.display_order,
 allowed_scopes=EXCLUDED.allowed_scopes;

INSERT INTO public.system_lists (category,value,is_active,display_order,metadata)
SELECT seed.category,seed.value,TRUE,seed.display_order,seed.metadata
FROM (VALUES
 ('service_request_rejection_agent_license','تعذر التحقق من هوية مقدم الطلب',10,'{"code":"applicant_identity_unverified"}'::jsonb),
 ('service_request_rejection_agent_license','بيانات غير صحيحة أو مضللة',20,'{"code":"invalid_or_misleading_data"}'::jsonb),
 ('service_request_rejection_agent_license','عدم استيفاء شروط الوكالة',30,'{"code":"eligibility_requirements_not_met"}'::jsonb),
 ('service_request_rejection_agent_license','اشتباه باحتيال أو إساءة استخدام',40,'{"code":"fraud_or_abuse_suspected"}'::jsonb),
 ('service_request_rejection_agent_license','تعذر استكمال المراجعة',50,'{"code":"unable_to_complete_review"}'::jsonb)
) seed(category,value,display_order,metadata)
WHERE NOT EXISTS (
 SELECT 1 FROM public.system_lists existing
 WHERE existing.category=seed.category AND existing.metadata->>'code'=seed.metadata->>'code'
);

COMMIT;
