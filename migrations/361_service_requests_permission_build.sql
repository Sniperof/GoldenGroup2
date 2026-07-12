-- ============================================================
-- 361_service_requests_permission_build.sql
-- ============================================================
-- Permission BUILD only (no role grants — granting is done manually via the
-- roles UI). Two standard-alignment refinements for the unified service-request
-- section (water_check + maintenance + future types):
--
--   1. Generalise the 6 display names from "الصيانة" (maintenance-only) to
--      "الخدمة" (service requests) — the intake layer is unified (SR-08), so a
--      maintenance-specific label misleads the operator granting them.
--   2. Add a dedicated `service_requests.resolve_escalation` (GLOBAL). Per the
--      permissions standard §4.1 (do not bundle security-different decisions),
--      de-escalation (reopens the workflow) is separated from `reject` (terminal).
--      Mirrors jobs.applications.resolve_escalation. See SR-ESC-02.
--
-- Idempotent.
-- ============================================================

BEGIN;

UPDATE public.permissions SET display_name = 'إنشاء طلب خدمة'          WHERE key = 'service_requests.create';
UPDATE public.permissions SET display_name = 'عرض طلبات الخدمة'         WHERE key = 'service_requests.view';
UPDATE public.permissions SET display_name = 'مراجعة وفرز طلبات الخدمة' WHERE key = 'service_requests.review';
UPDATE public.permissions SET display_name = 'رفض طلب خدمة (مدقّق فقط)'  WHERE key = 'service_requests.reject';
UPDATE public.permissions SET display_name = 'ترقية طلب خدمة إلى مهمة'   WHERE key = 'service_requests.promote';
UPDATE public.permissions SET display_name = 'أرشفة طلب خدمة'           WHERE key = 'service_requests.archive';

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('service_requests.resolve_escalation', 'service_requests', 'service_requests', 'resolve_escalation',
   'فكّ تصعيد طلب خدمة (مدقّق)', 256, ARRAY['GLOBAL'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
