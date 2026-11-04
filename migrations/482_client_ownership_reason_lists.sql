-- 482: Managed reason lists for client ownership operations (2026-10-18)
--
-- 481 took a free-text reason for every manual ownership operation. The
-- reasons are now admin-managed lists («إدارة القوائم»), one per operation,
-- plus an optional note:
--   client_ownership_add_reasons       إضافة مالك
--   client_ownership_remove_reasons    إزالة مالك
--   client_ownership_transfer_reasons  نقل بين موظفين
--   client_ownership_release_reasons   إرجاع للفرع
-- The log keeps the readable reason (label — note) and the list row id.
-- A reason whose value is 'other' requires the note (enforced by the API).

BEGIN;

-- ── 1) The lists ────────────────────────────────────────────────────────────
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT v.category, v.value, TRUE, v.ord, jsonb_build_object('label', v.label)
FROM (VALUES
  ('client_ownership_add_reasons',      'own_contact',          10, 'الاسم من معارف الموظف'),
  ('client_ownership_add_reasons',      'shared_follow_up',     20, 'متابعة مشتركة مع المالك الحالي'),
  ('client_ownership_add_reasons',      'data_correction',      30, 'تصحيح خطأ إدخال'),
  ('client_ownership_add_reasons',      'other',                99, 'أخرى'),

  ('client_ownership_remove_reasons',   'no_follow_up',         10, 'عدم متابعة الاسم'),
  ('client_ownership_remove_reasons',   'employee_request',     20, 'بطلب من الموظف'),
  ('client_ownership_remove_reasons',   'data_correction',      30, 'تصحيح خطأ إدخال'),
  ('client_ownership_remove_reasons',   'other',                99, 'أخرى'),

  ('client_ownership_transfer_reasons', 'redistribution',       10, 'إعادة توزيع الأسماء'),
  ('client_ownership_transfer_reasons', 'employee_unavailable', 20, 'تعذّر متابعة الموظف'),
  ('client_ownership_transfer_reasons', 'data_correction',      30, 'تصحيح خطأ إدخال'),
  ('client_ownership_transfer_reasons', 'other',                99, 'أخرى'),

  ('client_ownership_release_reasons',  'no_follow_up',         10, 'عدم متابعة الاسم'),
  ('client_ownership_release_reasons',  'branch_redistribution', 20, 'إعادة التوزيع على مستوى الفرع'),
  ('client_ownership_release_reasons',  'data_correction',      30, 'تصحيح خطأ إدخال'),
  ('client_ownership_release_reasons',  'other',                99, 'أخرى')
) AS v(category, value, ord, label)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
   WHERE sl.category = v.category AND sl.value = v.value
);

-- ── 2) The log keeps the chosen list row ────────────────────────────────────
ALTER TABLE public.client_ownership_log
  ADD COLUMN IF NOT EXISTS reason_id integer REFERENCES public.system_lists(id) ON DELETE SET NULL;

-- Same trigger as 481, plus reason_id from the transaction-local
-- app.ownership_reason_id setting the operation route sets.
CREATE OR REPLACE FUNCTION public.log_client_ownership_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.client_assignments%ROWTYPE;
  v_event text;
  v_actor integer;
  v_owner integer;
  v_owner_name text;
  v_reason_raw text := NULLIF(current_setting('app.ownership_reason_id', true), '');
  v_reason_id integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_row := NEW;
    v_event := 'owner_added';
  ELSE
    v_row := OLD;
    v_event := 'owner_removed';
  END IF;

  -- A hard delete of the client cascades here after the client row is gone:
  -- the log rows go with it, nothing to write.
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_row.client_id) THEN
    RETURN NULL;
  END IF;

  SELECT id, name INTO v_owner, v_owner_name FROM public.hr_users WHERE id = v_row.hr_user_id;

  v_actor := public.audit_actor_id();
  IF v_actor IS NULL AND TG_OP = 'INSERT' THEN
    SELECT id INTO v_actor FROM public.hr_users WHERE id = NEW.assigned_by;
  END IF;

  IF v_reason_raw ~ '^[0-9]+$' THEN
    SELECT id INTO v_reason_id FROM public.system_lists WHERE id = v_reason_raw::integer;
  END IF;

  INSERT INTO public.client_ownership_log (
    client_id, event_type, owner_user_id, owner_name,
    change_context, reason, reason_id, performed_by, role
  ) VALUES (
    v_row.client_id, v_event, v_owner, v_owner_name,
    public.audit_setting('change_context'),
    public.audit_setting('change_reason'),
    v_reason_id,
    v_actor,
    COALESCE(public.audit_setting('actor_role'), CASE WHEN v_actor IS NULL THEN 'system' END)
  );
  RETURN NULL;
END;
$$;

COMMIT;
