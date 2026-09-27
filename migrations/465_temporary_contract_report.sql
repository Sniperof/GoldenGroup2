BEGIN;

-- ── 1) Report permissions ───────────────────────────────────────────────────
-- ASSIGNED is declared: the row is a contract and `sale_owner_id` is a proven
-- assignment relation — the same one the daily sales-file report already scopes by,
-- so a seller can be granted their own trials without seeing a colleague's.
WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.daily_work.temporary_contract.view', 'reports', 'daily_work', 'view', 'عرض تقرير عقد مؤقت', 528, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]),
    ('reports.daily_work.temporary_contract.export', 'reports', 'daily_work', 'export', 'تصدير تقرير عقد مؤقت إلى Excel', 529, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[])
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

-- Conservative baseline: whoever may already read contracts gets the report at no
-- broader scope. Export stays a separate decision and is not granted here.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'contracts.view_list'
     AND grant_row.scope_type IN ('GLOBAL', 'BRANCH', 'ASSIGNED')
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.daily_work.temporary_contract.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 2) The trial grace period ───────────────────────────────────────────────
-- How long the customer may keep the trial device before the company may take it
-- back. Kept as an admin setting rather than pinned in code: the period is a
-- commercial decision, and the report's deadline column must follow it without a
-- code release. Seeded at 30 days by the business.
INSERT INTO public.system_settings (key, value, value_type, category, description)
VALUES ('trial_grace_period_days', '30', 'integer', 'contracts',
        'عدد أيام مهلة التجربة قبل جواز فك جهاز العقد المؤقت، تُحسب من تاريخ التركيب')
ON CONFLICT (key) DO NOTHING;

-- ── 3) Query support ────────────────────────────────────────────────────────
-- The report reads trials by contract, then resolves each one's closing retrieval
-- task and its linked calls. Indexes follow the query's own shape.
CREATE INDEX IF NOT EXISTS idx_open_tasks_contract_retrieval_purpose
  ON public.open_tasks (contract_id, task_type, retrieval_purpose);
CREATE INDEX IF NOT EXISTS idx_open_tasks_contract_task_type
  ON public.open_tasks (contract_id, task_type);

COMMIT;
