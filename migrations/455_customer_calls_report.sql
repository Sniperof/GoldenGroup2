BEGIN;

-- ── Report permissions ──────────────────────────────────────────────────────
-- ASSIGNED is declared: the row grain is a person, the subject is `employees`,
-- and the assignment relation is the caller's own employee record — so an
-- employee can be granted their own row without seeing a colleague's.
WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.performance.customer_calls.view', 'reports', 'performance', 'view', 'عرض تقرير اتصالات الزبائن', 522, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]),
    ('reports.performance.customer_calls.export', 'reports', 'performance', 'export', 'تصدير تقرير اتصالات الزبائن إلى Excel', 523, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[])
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

-- Conservative baseline: roles already allowed to see the call log get the report
-- at no broader scope, and export is not granted automatically.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'clients.call_log.view'
     AND grant_row.scope_type IN ('GLOBAL', 'BRANCH', 'ASSIGNED')
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.performance.customer_calls.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── Query support ───────────────────────────────────────────────────────────
-- The report reads calls by day and by caller, and resolves each call's subject
-- task through the link table.
CREATE INDEX IF NOT EXISTS idx_customer_call_logs_branch_date
  ON public.customer_call_logs (branch_id, call_date);
CREATE INDEX IF NOT EXISTS idx_customer_call_logs_caller
  ON public.customer_call_logs (caller_id);

COMMIT;
