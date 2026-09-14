BEGIN;

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.performance.sales_by_type.view', 'reports', 'performance', 'view', 'عرض تقرير المبيعات حسب النوع', 516, ARRAY['GLOBAL','BRANCH']::text[]),
    ('reports.performance.sales_by_type.export', 'reports', 'performance', 'export', 'تصدير تقرير المبيعات حسب النوع إلى Excel', 517, ARRAY['GLOBAL','BRANCH']::text[])
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
-- receive the report at no broader scope. ASSIGNED grants are deliberately skipped
-- because the report's row grain is the branch, so it declares no ASSIGNED scope
-- (a copied ASSIGNED grant would be a dead grant that hides the report anyway).
-- Export stays independent and is deliberately not auto-granted.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'contracts.view_list'
     AND grant_row.scope_type IN ('GLOBAL', 'BRANCH')
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.performance.sales_by_type.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- The offer population is filtered by the moment its result was closed, and that
-- column carries no index today (every other path this report walks is already
-- served: idx_contracts_branch_contract_date, idx_visit_tasks_field_visit,
-- uq_visit_task_results_task, idx_field_visits_branch_date, idx_demo_results_sale_ref).
CREATE INDEX IF NOT EXISTS idx_visit_task_results_closed_at
  ON public.visit_task_results (closed_at)
  WHERE closed_at IS NOT NULL;

COMMIT;
