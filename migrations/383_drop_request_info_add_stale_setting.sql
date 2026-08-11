-- ============================================================
-- 383_drop_request_info_add_stale_setting.sql
-- ============================================================
-- عقد قسم الطلبات §3 (docs/constitution/request-section-contract.md):
--
--   1. «طلب معلومات من الزبون» dropped: awaiting_customer_info is no longer
--      reachable (endpoints removed in code). Any request still parked there
--      is returned to in_review with an audit trail. The status value stays
--      valid in the DB CHECK constraint so historical audit payloads keep
--      rendering.
--
--   2. Stale-safety-net threshold (advisory only — the system NEVER closes
--      or rejects automatically): a request sitting in_review with no audit
--      activity for more than this many days gets a stale flag («ر») in the
--      lists and a supervisor filter. Admin-editable via system_settings.
--
-- Idempotent.
-- ============================================================

BEGIN;

-- 1. Defensive migration of any parked rows (none exist in dev as of today).
WITH moved AS (
  UPDATE public.service_requests
     SET status = 'in_review', updated_at = NOW()
   WHERE status = 'awaiting_customer_info'
  RETURNING id
)
INSERT INTO public.service_request_audit_log
  (service_request_id, event_type, event_payload, actor_user_id, actor_role, note)
SELECT id,
       'status_changed',
       jsonb_build_object(
         'from', 'awaiting_customer_info',
         'to', 'in_review',
         'reason', 'request_info_feature_dropped',
         'auto', true
       ),
       NULL,
       'system',
       'عقد قسم الطلبات §3 — إسقاط «طلب معلومات من الزبون»'
  FROM moved;

-- 2. Advisory stale threshold (days). 0 disables the flag.
INSERT INTO public.system_settings (key, value, value_type, category, description)
VALUES (
  'service_request_stale_after_days',
  '14',
  'integer',
  'service_requests',
  'عتبة الركود (أيام): طلب قيد المراجعة بلا أي حركة في سجل التدقيق أطول من هذه المدة يُعلَّم «راكد» في القوائم. تنبيه فقط — لا إغلاق تلقائي. القيمة 0 تعطّل العلامة.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
