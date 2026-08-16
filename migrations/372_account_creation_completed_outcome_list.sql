-- 372_account_creation_completed_outcome_list.sql
-- ============================================================
-- DEC-013 — admin-managed outcome list for the `completed` terminal of
-- account_creation requests (the link-and-activate decision). Mirrors the
-- resolve_at_intake lists (356): the state machine loads these values as the
-- allowed triage_outcome for in_review → completed on account_creation.
--
-- The outcome mirrors deriveSegment(clients.candidate_status): op/fop/lead map
-- to the promoted stages, `client` is a graduated full client with no stage.
-- Reject reasons intentionally reuse the shared hard-coded reject list (like
-- water_check), so no per-type reject list is seeded here.
-- ============================================================

BEGIN;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'service_request_completed_account_creation', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('linked_to_op',     10, '{"label":"مرتبط بزبون مُشغَّل (OP)","description":"رُبط الطلب بسجل زبون بحالة OP وفُعّل الحساب"}'),
  ('linked_to_fop',    20, '{"label":"مرتبط بزبون تشغيل ميداني (FOP)","description":"رُبط الطلب بسجل زبون بحالة FOP وفُعّل الحساب"}'),
  ('linked_to_lead',   30, '{"label":"مرتبط بعميل محتمل (Lead)","description":"رُبط الطلب بسجل عميل محتمل وفُعّل الحساب"}'),
  ('linked_to_client', 40, '{"label":"مرتبط بزبون قائم","description":"رُبط الطلب بسجل زبون قائم بلا حالة ترشيح وفُعّل الحساب"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'service_request_completed_account_creation'
    AND sl.value = v.value
);

COMMIT;
