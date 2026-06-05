-- ============================================================
-- 247_service_requests_permissions.sql
-- ============================================================
-- Phase 1.1 — Seed the 6 service_requests permissions.
--
-- Per maintenance.md §٠.١٦ (نموذج الصلاحية الثنائي + SR-08):
--
--   key                            | allowed scopes      | role primarily
--   service_requests.create        | BRANCH + GLOBAL     | any internal staff
--   service_requests.view          | GLOBAL only         | Operator + Audit Admin
--   service_requests.review        | GLOBAL only         | Admin Operator
--   service_requests.reject        | GLOBAL only         | Request Audit Admin
--   service_requests.promote       | GLOBAL only         | Admin Operator
--   service_requests.archive       | GLOBAL only         | Operator + Audit Admin
--
-- All non-create permissions are GLOBAL-only because the intake
-- layer is centralized (SR-08). BRANCH/ASSIGNED are not meaningful
-- for service_requests — branch_id is for tracking, not access.
--
-- Idempotent via ON CONFLICT (key) DO NOTHING (permissions_key_key).
--
-- Reference: docs/constitution/features/tasks/maintenance.md §٠.١٦
-- ============================================================

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('service_requests.create',  'service_requests', 'service_requests', 'create',
   'إنشاء طلب صيانة', 250, ARRAY['GLOBAL','BRANCH']),

  ('service_requests.view',    'service_requests', 'service_requests', 'view',
   'عرض طلبات الصيانة', 251, ARRAY['GLOBAL']),

  ('service_requests.review',  'service_requests', 'service_requests', 'review',
   'مراجعة وفرز طلبات الصيانة', 252, ARRAY['GLOBAL']),

  ('service_requests.reject',  'service_requests', 'service_requests', 'reject',
   'رفض طلب صيانة (مدقّق فقط)', 253, ARRAY['GLOBAL']),

  ('service_requests.promote', 'service_requests', 'service_requests', 'promote',
   'ترقية طلب صيانة إلى مهمة', 254, ARRAY['GLOBAL']),

  ('service_requests.archive', 'service_requests', 'service_requests', 'archive',
   'أرشفة طلب صيانة', 255, ARRAY['GLOBAL'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
