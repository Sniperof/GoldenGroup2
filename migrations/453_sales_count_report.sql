BEGIN;

-- ── 1) Report permissions ───────────────────────────────────────────────────
-- ASSIGNED is declared here, unlike the two aggregate reports before it: the row
-- grain is a person, the subject is `employees`, and the assignment relation is
-- proven (`hr_users.employee_id = contracts.sale_owner_id`) — so a seller can be
-- granted their own row without seeing a colleague's.
WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.performance.sales_count.view', 'reports', 'performance', 'view', 'عرض تقرير عدد المبيعات', 520, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]),
    ('reports.performance.sales_count.export', 'reports', 'performance', 'export', 'تصدير تقرير عدد المبيعات إلى Excel', 521, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[])
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

-- Conservative baseline: roles already allowed to view contract records get the
-- report at no broader scope, and export is not granted automatically.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'contracts.view_list'
     AND grant_row.scope_type IN ('GLOBAL', 'BRANCH', 'ASSIGNED')
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.performance.sales_count.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 2) Which job titles may own a sale ──────────────────────────────────────
-- Measured on the data: sale ownership is not one job title. Supervisors sell, and
-- so do maintenance technicians (two of the eighteen definitive sales are owned by
-- one), while marketing sells through its dealers and representatives.
--
-- This is stored under its own metadata key and NOT merged into `sellerJobTitles`
-- (migration 452) on purpose: that key feeds the «عدد البائع» headcount column of
-- the department-results report, and adding technicians to it would make every
-- service department look like it hired sellers overnight. Two questions, two keys.
--
-- «ديلر» is kept even though no employee currently carries it, so the list stays
-- true to the company's roles rather than to today's roster.
UPDATE public.system_lists
   SET metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('saleOwnerJobTitles',
                         jsonb_build_array('ديلر', 'مندوب التسويق')),
       updated_at = NOW()
 WHERE category = 'department_type' AND value = 'تسويق و مبيعات';

UPDATE public.system_lists
   SET metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('saleOwnerJobTitles',
                         jsonb_build_array('مشرفة', 'فني صيانة')),
       updated_at = NOW()
 WHERE category = 'department_type' AND value = 'صيانة و خدمة العملاء';

COMMIT;
