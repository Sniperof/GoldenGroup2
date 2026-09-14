BEGIN;

-- ── 1) Report permissions ───────────────────────────────────────────────────
-- ASSIGNED is declared: the row grain is a person and the assignment relation is
-- the technician's own employee record, so a technician can be granted their own
-- row without seeing a colleague's.
WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.performance.technician_work.view', 'reports', 'performance', 'view', 'عرض تقرير عمل الفنيين', 524, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]),
    ('reports.performance.technician_work.export', 'reports', 'performance', 'export', 'تصدير تقرير عمل الفنيين إلى Excel', 525, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[])
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

-- Conservative baseline: roles already allowed to see field visits get the report
-- at no broader scope, and export is not granted automatically.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'field_visits.view'
     AND grant_row.scope_type IN ('GLOBAL', 'BRANCH', 'ASSIGNED')
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.performance.technician_work.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 2) Who counts as a technician ───────────────────────────────────────────
-- The report lists every technician, so it needs to know which job titles are
-- technicians. Kept as an admin setting rather than pinned in code: `job_title` is
-- free text carrying 39 distinct values today, and a new technician title must not
-- require a code change to appear in the report.
INSERT INTO public.system_settings (key, value, value_type, category, description)
VALUES ('technician_job_titles', '["فني صيانة"]', 'json', 'reports',
        'المسميات الوظيفية التي تُعد فنيين في تقرير عمل الفنيين')
ON CONFLICT (key) DO NOTHING;

-- ── 3) Query support ────────────────────────────────────────────────────────
-- The report reads results by close date, then resolves each one's task and visit.
CREATE INDEX IF NOT EXISTS idx_visit_task_results_closed_at
  ON public.visit_task_results (closed_at);
CREATE INDEX IF NOT EXISTS idx_employees_status_job_title
  ON public.employees (status, job_title);

COMMIT;
