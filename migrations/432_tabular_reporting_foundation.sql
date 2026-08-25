BEGIN;

-- Tabular reports are independent capabilities. Viewing a dashboard metric or
-- the underlying clients/visits does not implicitly grant access to a report,
-- and viewing a report does not implicitly grant export.
WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    (
      'reports.work_files.geo_supervisors.view',
      'reports',
      'work_files',
      'view',
      'عرض تقرير ملف العمل الجغرافي للمشرفات',
      500,
      ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]
    ),
    (
      'reports.work_files.geo_supervisors.export',
      'reports',
      'work_files',
      'export',
      'تصدير تقرير ملف العمل الجغرافي للمشرفات إلى Excel',
      501,
      ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]
    )
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

-- The first report is an operational self-surface for supervisors. Other
-- roles receive it only through the normal role-permission administration UI.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'ASSIGNED'
FROM public.roles r
JOIN public.permissions p
  ON p.key IN (
    'reports.work_files.geo_supervisors.view',
    'reports.work_files.geo_supervisors.export'
  )
WHERE r.team_slot_type = 'SUPERVISOR'
  AND r.is_active IS TRUE
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  scope_type = CASE
    WHEN role_permission_grants.scope_type = 'GLOBAL' THEN 'GLOBAL'
    WHEN role_permission_grants.scope_type = 'BRANCH' THEN 'BRANCH'
    ELSE EXCLUDED.scope_type
  END,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.report_runs (
  id BIGSERIAL PRIMARY KEY,
  report_key TEXT NOT NULL,
  generated_by INTEGER NOT NULL REFERENCES public.hr_users(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('GLOBAL', 'BRANCH', 'ASSIGNED')),
  branch_ids INTEGER[] NOT NULL DEFAULT '{}',
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_runs_actor_created
  ON public.report_runs (generated_by, generated_at DESC);

CREATE TABLE IF NOT EXISTS public.report_run_rows (
  run_id BIGINT NOT NULL REFERENCES public.report_runs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  row_data JSONB NOT NULL,
  PRIMARY KEY (run_id, row_number)
);

CREATE TABLE IF NOT EXISTS public.report_export_audit (
  id BIGSERIAL PRIMARY KEY,
  report_run_id BIGINT REFERENCES public.report_runs(id),
  report_key TEXT NOT NULL,
  exported_by INTEGER NOT NULL REFERENCES public.hr_users(id),
  scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('GLOBAL','BRANCH','ASSIGNED')),
  branch_ids INTEGER[] NOT NULL DEFAULT '{}',
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.report_export_audit
  ADD COLUMN IF NOT EXISTS report_run_id BIGINT REFERENCES public.report_runs(id);

CREATE INDEX IF NOT EXISTS idx_report_export_audit_report_created
  ON public.report_export_audit (report_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_export_audit_actor_created
  ON public.report_export_audit (exported_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_open_tasks_device_demo_active_client
  ON public.open_tasks (client_id)
  WHERE task_type = 'device_demo'
    AND status IN (
      'open', 'needs_follow_up',
      'assigned', 'in_scheduling', 'scheduled',
      'waiting_execution', 'in_execution', 'ended'
    );

COMMIT;
