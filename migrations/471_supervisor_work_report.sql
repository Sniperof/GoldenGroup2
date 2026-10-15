BEGIN;

-- ── 1) Report permissions ───────────────────────────────────────────────────
-- ASSIGNED is declared: the row grain is a person and the assignment relation is
-- the supervisor's own employee record, so a supervisor can be granted her own row
-- without seeing a colleague's.
WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.performance.supervisor_work.view', 'reports', 'performance', 'view', 'عرض تقرير عمل المشرفات', 526, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]),
    ('reports.performance.supervisor_work.export', 'reports', 'performance', 'export', 'تصدير تقرير عمل المشرفات إلى Excel', 527, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[])
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

-- Conservative baseline, as for the technician work report (456): roles already
-- allowed to see field visits get the report at no broader scope, and export is not
-- granted automatically.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'field_visits.view'
     AND grant_row.scope_type IN ('GLOBAL', 'BRANCH', 'ASSIGNED')
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.performance.supervisor_work.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 2) Who counts as a supervisor ───────────────────────────────────────────
-- The report lists every supervisor, so it needs to know which job titles are
-- supervisors. An admin setting like `technician_job_titles`, so a new title does
-- not require a code change to appear in the report.
INSERT INTO public.system_settings (key, value, value_type, category, description)
VALUES ('supervisor_job_titles', '["مشرفة"]', 'json', 'reports',
        'المسميات الوظيفية التي تُعد مشرفات في تقرير عمل المشرفات')
ON CONFLICT (key) DO NOTHING;

-- ── 3) Query support ────────────────────────────────────────────────────────
-- «المهام المجدولة» reads visits by scheduled date across all branches under GLOBAL;
-- the existing (branch_id, scheduled_date) index only serves a branch-scoped read.
CREATE INDEX IF NOT EXISTS idx_field_visits_scheduled_date
  ON public.field_visits (scheduled_date);
-- «الأسماء المقترحة المضافة» counts a person's candidates added in the period. With
-- no index on the owner, each report row scanned the whole table (333k rows, ~2s a
-- row): 35s for this report and 25s for the technician report that shares the
-- lateral. Measured on golden_crm_srv 2026-09-30.
CREATE INDEX IF NOT EXISTS idx_candidates_owner_created_at
  ON public.candidates (owner_user_id, created_at);
-- Warranty money is read by who received it and when (DEC-SW-4).
CREATE INDEX IF NOT EXISTS idx_device_warranty_payments_receiver_received_at
  ON public.device_warranty_payments (received_by_employee_id, received_at);

COMMIT;
