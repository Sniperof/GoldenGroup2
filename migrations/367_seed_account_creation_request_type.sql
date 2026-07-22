-- ============================================================
-- 367_seed_account_creation_request_type.sql
-- ============================================================
-- Phase 3 (DEC-013) — register 'account_creation' in the request-type
-- registry so service_requests rows can pass service_requests_request_type_fk.
-- Mirrors 355 (water_check), but the type config is now a known shape
-- (public.service_request_type_config, PK request_type).
--
-- Policies reference the INDEPENDENT permission keys (account_requests.*),
-- and mark the link target as `clients` only (candidates excluded, DEC-013 §9.1).
-- Handoff is NOT a task: completion activates an app_account (side-effect).
-- ============================================================

BEGIN;

INSERT INTO public.service_request_type_config
  (request_type, label_ar, description_ar, is_active, display_order,
   default_form_version, form_source, channels, submitter_tiers, submission_modes,
   external_party_policy, linkage_policy, permission_policy, audit_policy)
VALUES
  ('account_creation',
   'طلب إنشاء حساب',
   'طلب من زائر التطبيق لإنشاء حساب تطبيق وربطه بسجل زبون قائم (clients).',
   TRUE,
   20,
   'account_creation.mobile.v1',
   'code_seeded',
   '["mobile_app"]'::jsonb,
   '["visitor"]'::jsonb,
   '["self"]'::jsonb,
   '{"snapshotRequired":true,"automaticClientCreation":false,"keepOriginalSubmittedData":true}'::jsonb,
   '{"linkTarget":"clients","candidateLinkAllowed":false,"requiredBeforeCompletion":["client_record"]}'::jsonb,
   '{"view":"account_requests.view","link":"account_requests.link","escalate":"account_requests.escalate","reject":"account_requests.reject","resolve_escalation":"account_requests.resolve_escalation","archive":"account_requests.archive"}'::jsonb,
   '{"created":"request_created","linked":"party_linked","completed":"account_linked","rejected":"rejected_decision"}'::jsonb)
ON CONFLICT (request_type) DO NOTHING;

COMMIT;
