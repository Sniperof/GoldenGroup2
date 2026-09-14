BEGIN;

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.daily_work.sales_file.view', 'reports', 'daily_work', 'view', 'عرض ملف البيعات اليومي', 514, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]),
    ('reports.daily_work.sales_file.export', 'reports', 'daily_work', 'export', 'تصدير ملف البيعات اليومي إلى Excel', 515, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[])
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

-- One-time conservative baseline: roles already allowed to view contract records
-- receive the report at no broader scope. Export stays independent and is
-- deliberately not auto-granted.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'contracts.view_list'
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.daily_work.sales_file.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Query-plan driven indexes for the two paths the report reaches that have none:
-- the sale-visit lookup by sale reference, and the primary branch + contract-date
-- filter over a column stored as VARCHAR.
CREATE INDEX IF NOT EXISTS idx_demo_results_sale_ref
  ON public.visit_task_device_demo_results (sale_reference_number)
  WHERE sale_reference_number IS NOT NULL;

-- The report compares the ISO-shaped text column directly (lexicographic order is
-- chronological there), so a plain btree serves the range; an expression index over
-- contract_date::date is rejected as non-IMMUTABLE.
CREATE INDEX IF NOT EXISTS idx_contracts_branch_contract_date
  ON public.contracts (branch_id, contract_date);

COMMIT;
