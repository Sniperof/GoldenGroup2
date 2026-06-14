-- ============================================================
-- 275_group_reference_data_lookup_with_system_lists.sql
-- ============================================================
-- Keep the lookup permission as a separate security decision, but display it
-- beside System Lists view/manage permissions so admins assign the trio from
-- one place.
-- ============================================================

BEGIN;

UPDATE public.permissions
SET
  module = 'admin',
  sub_module = 'system_lists',
  action = 'lookup',
  display_name = 'قراءة القيم المرجعية داخل الحقول',
  display_order = 44,
  allowed_scopes = ARRAY['GLOBAL','BRANCH','ASSIGNED']
WHERE key = 'reference_data.lookup';

COMMIT;
