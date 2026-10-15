BEGIN;

-- ── 1) Report permissions ───────────────────────────────────────────────────
-- ASSIGNED is declared: every case carries a responsible user (the request's
-- current reviewer, the visit team's responsible user, or the alert's recorded
-- responsible), so a user can be granted the cases they hold.
WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.daily_work.escalations.view', 'reports', 'daily_work', 'view', 'عرض تقرير حالات التصعيد', 530, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]),
    ('reports.daily_work.escalations.export', 'reports', 'daily_work', 'export', 'تصدير تقرير حالات التصعيد إلى Excel', 531, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[])
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

-- Conservative baseline (DEC-ESC-6): roles that already see the visit escalation
-- alerts get the report at no broader scope, and export is not granted.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'tasks.supervisor_alerts.view'
     AND grant_row.scope_type IN ('GLOBAL', 'BRANCH', 'ASSIGNED')
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.daily_work.escalations.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 2) Query support ────────────────────────────────────────────────────────
-- Not-started alerts are read by the moment they fired. The undocumented-visit
-- alerts are grouped per visit before the period applies, so an index on their
-- time would not serve the read; the audit log is served by its existing
-- (event_type, created_at) and (service_request_id, created_at) indexes.
CREATE INDEX IF NOT EXISTS idx_visit_scheduled_alerts_alerted_at
  ON public.visit_scheduled_alerts (alerted_at);

COMMIT;
