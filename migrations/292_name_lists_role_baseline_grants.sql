-- ============================================================
-- 292_name_lists_role_baseline_grants.sql
-- ============================================================
-- Name-lists (candidates.name_lists.*) role baseline, decided 2026-06-16:
--  - branch_manager: held ONLY assignment.manage (inert — the create/edit
--    endpoints gate on create/edit, so he could neither open the page nor
--    actually assign). Grant full BRANCH on the records family.
--  - company_manager (deputy super-admin): held NOTHING. Mirror the clients
--    baseline exactly — view_list/create/edit GLOBAL, delete/assignment BRANCH.
--
-- Idempotent and scope-safe (every scope is within the key's allowed_scopes).
-- Joins by role NAME and permission KEY so it is portable across environments.
-- ============================================================

BEGIN;

-- branch_manager → full BRANCH on the records family (assignment.manage already exists).
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'branch_manager'
  AND p.key IN (
    'candidates.name_lists.view_list',
    'candidates.name_lists.create',
    'candidates.name_lists.edit',
    'candidates.name_lists.delete'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

-- company_manager → clients-parity baseline.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, v.scope_type
FROM public.roles r
CROSS JOIN (VALUES
  ('candidates.name_lists.view_list',        'GLOBAL'),
  ('candidates.name_lists.create',           'GLOBAL'),
  ('candidates.name_lists.edit',             'GLOBAL'),
  ('candidates.name_lists.delete',           'BRANCH'),
  ('candidates.name_lists.assignment.manage','BRANCH')
) AS v(key, scope_type)
JOIN public.permissions p ON p.key = v.key
WHERE r.name = 'company_manager'
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

COMMIT;
