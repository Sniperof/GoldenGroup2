BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.complaint_public_ref_seq;

ALTER TABLE public.otp_verifications DROP CONSTRAINT IF EXISTS otp_verifications_purpose_check;
ALTER TABLE public.otp_verifications ADD CONSTRAINT otp_verifications_purpose_check CHECK (purpose IN (
  'account_creation','login','account_deletion','request_status','service_request',
  'complaint','complaint_tracking'
));

-- DEC-018: complaint photos reuse the unified media pipeline but are private.
ALTER TABLE public.media_files
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'public';

ALTER TABLE public.media_files
  DROP CONSTRAINT IF EXISTS media_files_visibility_ck,
  ADD CONSTRAINT media_files_visibility_ck CHECK (visibility IN ('public', 'private'));

ALTER TABLE public.media_files
  DROP CONSTRAINT IF EXISTS media_files_owner_type_ck,
  ADD CONSTRAINT media_files_owner_type_ck CHECK (
    owner_type IS NULL OR owner_type IN (
      'device_model', 'branch', 'app_home_banner', 'complaint_attachment'
    )
  );

CREATE INDEX IF NOT EXISTS idx_media_files_public_visibility
  ON public.media_files (public_id, extension)
  WHERE visibility = 'public';

CREATE TABLE IF NOT EXISTS public.complaints (
  id BIGSERIAL PRIMARY KEY,
  public_ref_number VARCHAR(24) NOT NULL UNIQUE,
  complaint_type VARCHAR(20) NOT NULL,
  category_code VARCHAR(50),
  other_category_text VARCHAR(300),
  description TEXT NOT NULL,
  entry_point VARCHAR(30) NOT NULL,
  source_channel VARCHAR(30) NOT NULL,
  identity_source VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'new',
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  review_required BOOLEAN NOT NULL DEFAULT FALSE,
  suspected_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_complaint_id BIGINT REFERENCES public.complaints(id) ON DELETE SET NULL,
  origin_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  target_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  handling_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  assigned_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  requester_app_account_id BIGINT REFERENCES public.app_accounts(id) ON DELETE SET NULL,
  requester_client_id INTEGER REFERENCES public.clients(id) ON DELETE SET NULL,
  submitter_device_hash CHAR(64),
  submitter_ip_hash CHAR(64),
  field_visit_id BIGINT REFERENCES public.field_visits(id) ON DELETE SET NULL,
  installed_device_id INTEGER REFERENCES public.installed_devices(id) ON DELETE SET NULL,
  context_snapshot JSONB,
  expected_contact_method VARCHAR(20) NOT NULL DEFAULT 'no_preference',
  entered_by_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT complaints_type_ck CHECK (complaint_type IN ('technical','device','general')),
  CONSTRAINT complaints_status_ck CHECK (status IN (
    'new','triaged','assigned','in_progress','awaiting_complainant',
    'resolved','closed','rejected','withdrawn'
  )),
  CONSTRAINT complaints_priority_ck CHECK (priority IN ('critical','high','normal','low')),
  CONSTRAINT complaints_identity_source_ck CHECK (identity_source IN (
    'app_account','visitor_otp','unverified_device','staff_recorded'
  )),
  CONSTRAINT complaints_entry_point_ck CHECK (entry_point IN (
    'home','visit_detail','device_detail','crm_general','crm_visit','crm_device'
  )),
  CONSTRAINT complaints_source_channel_ck CHECK (source_channel IN (
    'mobile_app','phone','website','whatsapp','in_person'
  )),
  CONSTRAINT complaints_contact_method_ck CHECK (expected_contact_method IN (
    'phone','whatsapp','sms','no_preference'
  )),
  CONSTRAINT complaints_description_ck CHECK (length(btrim(description)) BETWEEN 20 AND 5000),
  CONSTRAINT complaints_context_type_ck CHECK (
    (field_visit_id IS NULL OR complaint_type = 'technical')
    AND (installed_device_id IS NULL OR complaint_type = 'device')
  ),
  CONSTRAINT complaints_other_category_ck CHECK (
    category_code <> 'other' OR length(btrim(COALESCE(other_category_text,''))) > 0
  )
);

CREATE INDEX IF NOT EXISTS complaints_queue_idx
  ON public.complaints (status, priority, created_at);
CREATE INDEX IF NOT EXISTS complaints_handling_scope_idx
  ON public.complaints (handling_branch_id, assigned_user_id, status);
CREATE INDEX IF NOT EXISTS complaints_requester_client_idx
  ON public.complaints (requester_client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS complaints_visit_idx ON public.complaints (field_visit_id);
CREATE INDEX IF NOT EXISTS complaints_device_idx ON public.complaints (installed_device_id);

CREATE TABLE IF NOT EXISTS public.complaint_requesters (
  complaint_id BIGINT PRIMARY KEY REFERENCES public.complaints(id) ON DELETE CASCADE,
  first_name VARCHAR(60) NOT NULL,
  middle_name VARCHAR(60),
  last_name VARCHAR(60) NOT NULL,
  primary_phone VARCHAR(20) NOT NULL,
  primary_phone_has_whatsapp BOOLEAN,
  secondary_phone VARCHAR(20),
  secondary_phone_has_whatsapp BOOLEAN,
  governorate_id INTEGER NOT NULL REFERENCES public.geo_units(id) ON DELETE RESTRICT,
  region_id INTEGER REFERENCES public.geo_units(id) ON DELETE RESTRICT,
  subdistrict_id INTEGER REFERENCES public.geo_units(id) ON DELETE RESTRICT,
  neighborhood_id INTEGER REFERENCES public.geo_units(id) ON DELETE RESTRICT,
  detailed_address VARCHAR(500),
  address_snapshot JSONB NOT NULL,
  client_classification_snapshot VARCHAR(10),
  link_status VARCHAR(20) NOT NULL DEFAULT 'unlinked',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT complaint_requester_secondary_whatsapp_ck CHECK (
    secondary_phone IS NOT NULL OR secondary_phone_has_whatsapp IS NULL
  ),
  CONSTRAINT complaint_requester_classification_ck CHECK (
    client_classification_snapshot IS NULL OR client_classification_snapshot IN ('LEAD','FOP','OP')
  ),
  CONSTRAINT complaint_requester_link_status_ck CHECK (
    link_status IN ('unlinked','linked','not_required')
  )
);

CREATE INDEX IF NOT EXISTS complaint_requesters_phone_idx
  ON public.complaint_requesters (primary_phone);

CREATE TABLE IF NOT EXISTS public.complaint_technical_details (
  complaint_id BIGINT PRIMARY KEY REFERENCES public.complaints(id) ON DELETE CASCADE,
  incident_date DATE,
  reported_target_name VARCHAR(200),
  visit_snapshot JSONB
);

CREATE TABLE IF NOT EXISTS public.complaint_device_details (
  complaint_id BIGINT PRIMARY KEY REFERENCES public.complaints(id) ON DELETE CASCADE,
  manual_device_number VARCHAR(255),
  manual_device_name VARCHAR(255),
  manual_device_serial VARCHAR(255),
  reported_last_maintenance_date DATE,
  device_snapshot JSONB
);
ALTER TABLE public.complaint_device_details
  ADD COLUMN IF NOT EXISTS manual_device_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS manual_device_serial VARCHAR(255);

CREATE TABLE IF NOT EXISTS public.complaint_targets (
  id BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  target_type VARCHAR(30) NOT NULL,
  target_entity_id BIGINT,
  target_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_by_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT complaint_target_type_ck CHECK (target_type IN (
    'employee','field_team','branch','field_visit','service_execution','unknown'
  ))
);

CREATE TABLE IF NOT EXISTS public.complaint_assignments (
  id BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  assignment_type VARCHAR(20) NOT NULL,
  from_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  to_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  from_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  to_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  reason TEXT,
  assigned_by_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT complaint_assignment_type_ck CHECK (assignment_type IN ('branch','handler'))
);

CREATE TABLE IF NOT EXISTS public.complaint_operational_links (
  id BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT NOT NULL,
  relation_type VARCHAR(40) NOT NULL,
  created_by_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (complaint_id, entity_type, entity_id, relation_type)
);

CREATE TABLE IF NOT EXISTS public.complaint_attachments (
  id BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT REFERENCES public.complaints(id) ON DELETE CASCADE,
  media_file_id BIGINT NOT NULL UNIQUE REFERENCES public.media_files(id) ON DELETE RESTRICT,
  upload_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  identity_kind VARCHAR(30) NOT NULL,
  identity_key VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
  consumed_at TIMESTAMPTZ,
  quarantined_at TIMESTAMPTZ,
  quarantine_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT complaint_attachment_identity_ck CHECK (
    identity_kind IN ('app_account','visitor_otp','unverified_device')
  )
);

CREATE INDEX IF NOT EXISTS complaint_attachments_pending_idx
  ON public.complaint_attachments (upload_token, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.complaint_tracking_grants (
  handle UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id BIGINT NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.complaint_public_updates (
  id BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  public_status VARCHAR(30) NOT NULL,
  message TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  published_by_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.complaint_internal_notes (
  id BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.complaint_resolutions (
  id BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  outcome VARCHAR(50) NOT NULL,
  internal_notes TEXT NOT NULL,
  public_summary TEXT NOT NULL,
  resolved_by_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT complaint_resolution_outcome_ck CHECK (outcome IN (
    'upheld','partially_upheld','not_upheld','service_recovery_completed',
    'redirected_to_service','duplicate_confirmed'
  ))
);

ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS current_resolution_id BIGINT;
ALTER TABLE public.complaints
  DROP CONSTRAINT IF EXISTS complaints_current_resolution_fkey,
  ADD CONSTRAINT complaints_current_resolution_fkey
    FOREIGN KEY (current_resolution_id) REFERENCES public.complaint_resolutions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.complaint_status_history (
  id BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  reason TEXT,
  actor_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  actor_app_account_id BIGINT REFERENCES public.app_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.complaint_audit_log (
  id BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  event_type VARCHAR(60) NOT NULL,
  actor_type VARCHAR(20) NOT NULL,
  actor_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  actor_app_account_id BIGINT REFERENCES public.app_accounts(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT complaint_audit_actor_ck CHECK (actor_type IN ('staff','app_account','visitor','system'))
);

CREATE OR REPLACE FUNCTION public.tg_complaints_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS complaints_set_updated_at ON public.complaints;
CREATE TRIGGER complaints_set_updated_at
  BEFORE UPDATE ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.tg_complaints_set_updated_at();

CREATE OR REPLACE FUNCTION public.tg_complaint_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'complaint_public_updates','complaint_internal_notes','complaint_resolutions',
    'complaint_status_history','complaint_audit_log','complaint_assignments'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_no_update ON public.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_no_update BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_complaint_append_only()', table_name, table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_no_delete ON public.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_no_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_complaint_append_only()', table_name, table_name);
  END LOOP;
END $$;

INSERT INTO public.permissions (key,module,sub_module,action,display_name,display_order,allowed_scopes)
VALUES
 ('complaints.view_list','complaints','complaints','view_list','عرض قائمة الشكاوى',310,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.view_details','complaints','complaints','view_details','عرض تفاصيل الشكوى',311,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.create_internal','complaints','complaints','create_internal','تسجيل شكوى من النظام',312,ARRAY['GLOBAL','BRANCH']),
 ('complaints.triage','complaints','workflow','triage','فرز الشكاوى',313,ARRAY['GLOBAL']),
 ('complaints.change_type','complaints','workflow','change_type','تغيير نوع الشكوى',314,ARRAY['GLOBAL']),
 ('complaints.change_priority','complaints','workflow','change_priority','تغيير أولوية الشكوى',315,ARRAY['GLOBAL']),
 ('complaints.assign_branch','complaints','assignment','assign_branch','تعيين فرع معالجة',316,ARRAY['GLOBAL']),
 ('complaints.transfer_branch','complaints','assignment','transfer_branch','نقل فرع معالجة',317,ARRAY['GLOBAL']),
 ('complaints.assign_handler','complaints','assignment','assign_handler','تعيين معالج شكوى',318,ARRAY['GLOBAL','BRANCH']),
 ('complaints.reassign_handler','complaints','assignment','reassign_handler','إعادة تعيين معالج شكوى',319,ARRAY['GLOBAL','BRANCH']),
 ('complaints.start_processing','complaints','workflow','start_processing','بدء معالجة الشكوى',320,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.request_information','complaints','workflow','request_information','انتظار معلومات من مقدم الشكوى',321,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.resume_processing','complaints','workflow','resume_processing','استئناف معالجة الشكوى',322,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.resolve','complaints','workflow','resolve','حل الشكوى',323,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.close','complaints','workflow','close','إغلاق الشكوى',324,ARRAY['GLOBAL']),
 ('complaints.reject','complaints','workflow','reject','رفض الشكوى',325,ARRAY['GLOBAL']),
 ('complaints.withdraw','complaints','workflow','withdraw','تسجيل سحب الشكوى',326,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.reopen','complaints','workflow','reopen','إعادة فتح الشكوى',327,ARRAY['GLOBAL']),
 ('complaints.review_duplicates','complaints','workflow','review_duplicates','مراجعة تكرار الشكاوى',328,ARRAY['GLOBAL']),
 ('complaints.add_internal_note','complaints','notes','add_internal_note','إضافة ملاحظة داخلية',329,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.publish_update','complaints','updates','publish_update','نشر تحديث لمقدم الشكوى',330,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.view_attachments','complaints','attachments','view','عرض صور الشكوى',331,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.download_attachments','complaints','attachments','download','تنزيل صور الشكوى',332,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.view_audit','complaints','audit','view','عرض سجل تدقيق الشكوى',333,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.view_reports','complaints','reports','view','عرض تقارير الشكاوى',334,ARRAY['GLOBAL','BRANCH']),
 ('complaints.export','complaints','reports','export','تصدير الشكاوى',335,ARRAY['GLOBAL','BRANCH']),
 ('complaints.link_requester','complaints','links','link_requester','ربط مقدم الشكوى',336,ARRAY['GLOBAL']),
 ('complaints.link_visit','complaints','links','link_visit','ربط زيارة بالشكوى',337,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.link_device','complaints','links','link_device','ربط جهاز بالشكوى',338,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.link_target','complaints','links','link_target','ربط الجهة المشكو عليها',339,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.link_operational_work','complaints','links','link_work','ربط عمل تشغيلي بالشكوى',340,ARRAY['GLOBAL','BRANCH','ASSIGNED']),
 ('complaints.manage_duplicate_settings','complaints','settings','duplicates','إدارة إعدادات تكرار الشكاوى',341,ARRAY['GLOBAL']),
 ('complaints.manage_abuse_settings','complaints','settings','abuse','إدارة حدود تقديم الشكاوى',342,ARRAY['GLOBAL'])
ON CONFLICT (key) DO UPDATE SET
 module=EXCLUDED.module,sub_module=EXCLUDED.sub_module,action=EXCLUDED.action,
 display_name=EXCLUDED.display_name,display_order=EXCLUDED.display_order,
 allowed_scopes=EXCLUDED.allowed_scopes;

INSERT INTO public.system_settings (key,value,value_type,category,description,is_editable)
VALUES
 ('complaints_duplicate_detection_enabled','true','boolean','complaints','تشغيل كشف تكرار الشكاوى',TRUE),
 ('complaints_duplicate_visit_window_days','30','integer','complaints','نافذة تكرار شكوى الزيارة بالأيام',TRUE),
 ('complaints_duplicate_device_window_days','30','integer','complaints','نافذة تكرار شكوى الجهاز بالأيام',TRUE),
 ('complaints_duplicate_exact_text_window_hours','24','integer','complaints','نافذة النص المطابق بالساعات',TRUE),
 ('complaints_unverified_device_daily_limit','3','integer','complaints','حد شكاوى الجهاز غير المثبت يومياً',TRUE),
 ('complaints_unverified_ip_daily_limit','10','integer','complaints','حد شكاوى IP غير المثبت يومياً',TRUE),
 ('complaints_unverified_phone_daily_limit','3','integer','complaints','حد شكاوى الهاتف غير المثبت يومياً',TRUE),
 ('complaints_verified_phone_daily_limit','10','integer','complaints','حد شكاوى الهاتف المثبت يومياً',TRUE),
 ('complaints_account_daily_limit','10','integer','complaints','حد شكاوى حساب التطبيق يومياً',TRUE),
 ('complaints_upload_daily_byte_limit','52428800','integer','complaints','حد رفع صور الشكاوى لكل هوية خلال 24 ساعة بالبايت',TRUE)
ON CONFLICT (key) DO NOTHING;

COMMIT;
