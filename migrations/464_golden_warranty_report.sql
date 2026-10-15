BEGIN;

-- ── 1) Report permissions ───────────────────────────────────────────────────
-- ASSIGNED is NOT declared: the row is a warranty, and no assignment relation
-- binds a person to it. The supervisor and technician on the row executed the
-- offer visit and do not own the warranty afterwards, so granting ASSIGNED would
-- hand out rows on a link rather than on a responsibility (reporting §9.6).
WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.service.golden_warranty.view', 'reports', 'service', 'view', 'عرض تقرير الكفالة الذهبية', 526, ARRAY['GLOBAL','BRANCH']::text[]),
    ('reports.service.golden_warranty.export', 'reports', 'service', 'export', 'تصدير تقرير الكفالة الذهبية إلى Excel', 527, ARRAY['GLOBAL','BRANCH']::text[])
)
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
SELECT key, module, sub_module, action, display_name, display_order, allowed_scopes
FROM source_permissions
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

-- Conservative baseline: whoever may already see installed devices gets the report
-- at no broader scope, because every row it shows is a device they can already open.
-- ASSIGNED grants are deliberately not carried over — the report does not support it.
-- Export is not granted automatically; it is a separate gate by design.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'installed_devices.view'
     AND grant_row.scope_type IN ('GLOBAL', 'BRANCH')
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.service.golden_warranty.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 2) Query support ────────────────────────────────────────────────────────
-- The report's subject is the golden warranty, read per device and ordered by the
-- end date; the parts window is read per device and event type. Both indexes come
-- from the query's own shape, not from guesswork.
CREATE INDEX IF NOT EXISTS idx_device_warranties_type_device
  ON public.device_warranties (warranty_type, device_id);
CREATE INDEX IF NOT EXISTS idx_device_warranties_type_end_date
  ON public.device_warranties (warranty_type, end_date);
CREATE INDEX IF NOT EXISTS idx_device_installed_parts_device_event
  ON public.device_installed_parts (device_id, event_type);
CREATE INDEX IF NOT EXISTS idx_device_technical_states_device_created
  ON public.device_technical_states (installed_device_id, created_at DESC);

COMMIT;
