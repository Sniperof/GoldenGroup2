-- ============================================================
-- 271_reference_data_lookup_permission.sql
-- ============================================================
-- Split reference-data lookup from admin surface visibility.
--
-- Pages such as branch/department/device/system-list administration remain
-- governed by their existing management/view permissions. This permission is
-- for routine workflows that need dropdown data (branches, departments,
-- devices, system list values) without exposing those admin pages in the
-- sidebar.
-- ============================================================

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('reference_data.lookup', 'reference_data', 'lookups', 'lookup',
   'عرض القوائم المرجعية داخل العمليات', 5, ARRAY['GLOBAL','BRANCH','ASSIGNED'])
ON CONFLICT (key) DO NOTHING;

-- Give lookup access to roles that already have operational permissions.
-- The scope follows the broadest operational scope on that role, without
-- granting admin-page visibility such as branches.view or catalog.manage.
WITH lookup_perm AS (
  SELECT id FROM public.permissions WHERE key = 'reference_data.lookup'
), operational_roles AS (
  SELECT
    rpg.role_id,
    CASE
      WHEN BOOL_OR(rpg.scope_type = 'GLOBAL') THEN 'GLOBAL'
      WHEN BOOL_OR(rpg.scope_type = 'BRANCH') THEN 'BRANCH'
      ELSE 'ASSIGNED'
    END::varchar AS scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key IN (
    'clients.view_list', 'clients.create', 'clients.edit',
    'candidates.view_list', 'candidates.create', 'candidates.edit',
    'employees.view_list', 'employees.create', 'employees.edit',
    'contracts.view_list', 'contracts.create', 'contracts.edit',
    'open_tasks.view', 'open_tasks.edit',
    'tasks.view', 'tasks.delivery.create', 'tasks.installation.create', 'tasks.activation.create',
    'field_visits.view', 'field_visits.edit',
    'geo.view',
    'telemarketing.targets.view', 'telemarketing.lists.view', 'telemarketing.calls.create',
    'telemarketing.appointments.book',
    'service_requests.create', 'service_requests.review', 'service_requests.promote',
    'jobs.vacancies.view_list', 'jobs.vacancies.create',
    'jobs.training.create', 'jobs.applications.create'
  )
  GROUP BY rpg.role_id
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT operational_roles.role_id, lookup_perm.id, operational_roles.scope_type
FROM operational_roles
CROSS JOIN lookup_perm
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
