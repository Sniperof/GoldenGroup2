-- ============================================================
-- 366_app_account_permissions.sql
-- ============================================================
-- Phase 1 (DEC-013 §9.9) — permission BUILD only (no role grants;
-- granting is done manually via the roles UI, like 361).
--
-- Independent permission namespaces for the account-creation epic,
-- deliberately SEPARATE from service_requests.* so "review account
-- requests" / "activate accounts" can be granted in isolation.
--
-- Two modules:
--   account_requests.*  — the request review path (Operator + Audit)
--   app_accounts.*      — account lifecycle (mostly Audit-only)
--
-- Security-different decisions are separate keys (permissions std §4.1):
-- reject / suspend / reactivate / create_direct / bulk_activate each stand
-- alone so the Operator↔Audit split is enforceable by grant.
--
-- All GLOBAL scope. Idempotent.
-- Reference: docs/constitution/features/account-creation-and-app-auth.md §2.1
-- ============================================================

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  -- account_requests.* — request review path
  ('account_requests.view',               'account_requests', 'account_requests', 'view',               'عرض طلبات إنشاء الحساب',                 400, ARRAY['GLOBAL']),
  ('account_requests.link',               'account_requests', 'account_requests', 'link',               'اعتماد ربط طلب إنشاء الحساب',             401, ARRAY['GLOBAL']),
  ('account_requests.escalate',           'account_requests', 'account_requests', 'escalate',           'تصعيد طلب إنشاء الحساب',                  402, ARRAY['GLOBAL']),
  ('account_requests.reject',             'account_requests', 'account_requests', 'reject',             'رفض طلب إنشاء الحساب (مدقّق)',            403, ARRAY['GLOBAL']),
  ('account_requests.resolve_escalation', 'account_requests', 'account_requests', 'resolve_escalation', 'فكّ تصعيد طلب إنشاء الحساب (مدقّق)',      404, ARRAY['GLOBAL']),
  ('account_requests.archive',            'account_requests', 'account_requests', 'archive',            'أرشفة طلب إنشاء الحساب',                  405, ARRAY['GLOBAL']),

  -- app_accounts.* — account lifecycle
  ('app_accounts.view',           'app_accounts', 'app_accounts', 'view',           'عرض حسابات التطبيق',                     410, ARRAY['GLOBAL']),
  ('app_accounts.create_direct',  'app_accounts', 'app_accounts', 'create_direct',  'إنشاء حساب تطبيق مباشر (مدقّق)',          411, ARRAY['GLOBAL']),
  ('app_accounts.bulk_activate',  'app_accounts', 'app_accounts', 'bulk_activate',  'تفعيل حسابات تطبيق جماعي (مدقّق)',        412, ARRAY['GLOBAL']),
  ('app_accounts.suspend',        'app_accounts', 'app_accounts', 'suspend',        'إيقاف حساب تطبيق (مدقّق)',                413, ARRAY['GLOBAL']),
  ('app_accounts.reactivate',     'app_accounts', 'app_accounts', 'reactivate',     'إعادة تفعيل حساب تطبيق (مدقّق)',          414, ARRAY['GLOBAL'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
