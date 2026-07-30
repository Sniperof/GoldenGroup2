-- ============================================================
-- 382_request_permission_families.sql
-- ============================================================
-- عقد قسم الطلبات (docs/constitution/request-section-contract.md) §5:
-- one standard 5-key permission family per request type, with strict
-- cross-type isolation and one semantic per key across all types.
--
--   <family>.view               — list + detail
--   <family>.review             — claim/take-over/link/notes/escalate
--   <family>.decide             — reject/resolve/promote|complete/reopen/cancel
--   <family>.resolve_escalation — unlock escalated requests
--   <family>.archive            — archive/unarchive
--   (+ <family>.create only for staff-intake types)
--
-- Changes:
--   A. service_requests (maintenance family): reject+promote → decide.
--   B. water_check: new dedicated family (was riding on service_requests.*).
--      Continuity: roles holding service_requests.<action> receive the
--      matching water_check.<action> so nobody silently loses access.
--   C. account_requests: link/escalate/reject → review/decide alignment.
--      Continuity: link → review+decide (a link-holder could both work the
--      request AND take the approve decision), escalate → review,
--      reject → decide.
--   D. Registry permission_policy rows updated to the new keys.
--
-- No new grants are invented — only existing grants are remapped.
-- Idempotent.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- A. service_requests family: decide replaces reject + promote
-- ------------------------------------------------------------
INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('service_requests.decide', 'service_requests', 'service_requests', 'decide',
   'حسم طلب صيانة (رفض/حل/ترقية/إعادة فتح)', 255, ARRAY['GLOBAL'])
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, np.id
  FROM public.role_permissions rp
  JOIN public.permissions op
    ON op.id = rp.permission_id
   AND op.key IN ('service_requests.reject', 'service_requests.promote')
  JOIN public.permissions np ON np.key = 'service_requests.decide'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Maintenance family labels say "صيانة" now that water_check has its own keys.
UPDATE public.permissions SET display_name = 'إنشاء طلب صيانة'            WHERE key = 'service_requests.create';
UPDATE public.permissions SET display_name = 'عرض طلبات الصيانة'           WHERE key = 'service_requests.view';
UPDATE public.permissions SET display_name = 'مراجعة وفرز طلبات الصيانة'   WHERE key = 'service_requests.review';
UPDATE public.permissions SET display_name = 'أرشفة طلب صيانة'             WHERE key = 'service_requests.archive';
UPDATE public.permissions SET display_name = 'فكّ تصعيد طلب صيانة (مدقّق)' WHERE key = 'service_requests.resolve_escalation';

-- ------------------------------------------------------------
-- B. water_check family (create = internal simulator/staff intake)
-- ------------------------------------------------------------
INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('water_check.view',               'water_check', 'water_check', 'view',
   'عرض طلبات فحص المياه', 260, ARRAY['GLOBAL']),
  ('water_check.review',             'water_check', 'water_check', 'review',
   'مراجعة وفرز طلبات فحص المياه', 261, ARRAY['GLOBAL']),
  ('water_check.decide',             'water_check', 'water_check', 'decide',
   'حسم طلب فحص المياه (رفض/حل/تحويل لمهمة/إعادة فتح)', 262, ARRAY['GLOBAL']),
  ('water_check.resolve_escalation', 'water_check', 'water_check', 'resolve_escalation',
   'فكّ تصعيد طلب فحص المياه (مدقّق)', 263, ARRAY['GLOBAL']),
  ('water_check.archive',            'water_check', 'water_check', 'archive',
   'أرشفة طلب فحص المياه', 264, ARRAY['GLOBAL']),
  ('water_check.create',             'water_check', 'water_check', 'create',
   'إنشاء/محاكاة طلب فحص مياه', 265, ARRAY['GLOBAL'])
ON CONFLICT (key) DO NOTHING;

-- Continuity: water_check was governed by service_requests.* until now.
-- (reject/promote map onto water_check.decide via the decide row added in A.)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, np.id
  FROM public.role_permissions rp
  JOIN public.permissions op
    ON op.id = rp.permission_id
   AND op.key LIKE 'service\_requests.%'
  JOIN public.permissions np
    ON np.key = 'water_check.' || split_part(op.key, '.', 2)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ------------------------------------------------------------
-- C. account_requests family: align to the standard semantics
-- ------------------------------------------------------------
INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('account_requests.review', 'account_requests', 'account_requests', 'review',
   'مراجعة وفرز طلبات إنشاء الحساب', 270, ARRAY['GLOBAL']),
  ('account_requests.decide', 'account_requests', 'account_requests', 'decide',
   'حسم طلب إنشاء الحساب (اعتماد/رفض/إعادة فتح)', 271, ARRAY['GLOBAL'])
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, np.id
  FROM public.role_permissions rp
  JOIN public.permissions op ON op.id = rp.permission_id
  JOIN public.permissions np
    ON (op.key = 'account_requests.link'     AND np.key IN ('account_requests.review', 'account_requests.decide'))
    OR (op.key = 'account_requests.escalate' AND np.key = 'account_requests.review')
    OR (op.key = 'account_requests.reject'   AND np.key = 'account_requests.decide')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ------------------------------------------------------------
-- Retire the replaced keys (grants cascade-delete)
-- ------------------------------------------------------------
DELETE FROM public.permissions
 WHERE key IN (
   'service_requests.reject', 'service_requests.promote',
   'account_requests.link', 'account_requests.escalate', 'account_requests.reject'
 );

-- ------------------------------------------------------------
-- D. Registry permission_policy → new keys
-- ------------------------------------------------------------
UPDATE public.service_request_type_config
   SET permission_policy = '{
         "mobileIntake": "visitor_otp_or_app_account",
         "view": "water_check.view",
         "review": "water_check.review",
         "decide": "water_check.decide",
         "resolve_escalation": "water_check.resolve_escalation",
         "archive": "water_check.archive",
         "create": "water_check.create"
       }'::jsonb,
       updated_at = NOW()
 WHERE request_type = 'water_check';

UPDATE public.service_request_type_config
   SET permission_policy = '{
         "mobileIntake": "visitor_otp",
         "view": "account_requests.view",
         "review": "account_requests.review",
         "decide": "account_requests.decide",
         "resolve_escalation": "account_requests.resolve_escalation",
         "archive": "account_requests.archive"
       }'::jsonb,
       updated_at = NOW()
 WHERE request_type = 'account_creation';

UPDATE public.service_request_type_config
   SET permission_policy = '{
         "view": "service_requests.view",
         "review": "service_requests.review",
         "decide": "service_requests.decide",
         "resolve_escalation": "service_requests.resolve_escalation",
         "archive": "service_requests.archive",
         "create": "service_requests.create"
       }'::jsonb,
       updated_at = NOW()
 WHERE request_type = 'emergency_maintenance';

COMMIT;
