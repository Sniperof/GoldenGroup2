-- ============================================================
-- 297_employees_role_baseline_grants.sql
-- ============================================================
-- Employee records (employees.*) role baseline, decided 2026-06-17 during the
-- employees section permission audit. Brings the deputy in line with the
-- clients/name-lists "company_manager" model and tightens an over-broad
-- technician grant.
--
--  - company_manager (النائب): held only view_list + lookup GLOBAL. Mirror the
--    clients model → view/create/edit GLOBAL, delete BRANCH, plus the nav and
--    manager_lookup he needs to reach the screen and pick direct managers, plus
--    the support lookups (branch/department/geo/reference) the create & edit
--    forms read. delete stays BRANCH for clients/name-lists parity.
--  - tech (الفني): employees.view_list was GLOBAL (every branch's roster). The
--    technician only needs to see his own branch → downgrade to BRANCH.
--
-- Idempotent; joins by role NAME and permission KEY for portability.
-- ============================================================

BEGIN;

-- company_manager → GLOBAL on the read/write keys that mirror his clients model.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'company_manager'
  AND p.key IN (
    'employees.nav',
    'employees.view_list',
    'employees.create',
    'employees.edit',
    'employees.lookup',
    'employees.manager_lookup'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

-- company_manager → delete stays BRANCH (clients / name-lists parity).
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'company_manager'
  AND p.key = 'employees.delete'
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

-- company_manager → support lookups read by the create/edit employee forms.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'company_manager'
  AND p.key IN (
    'branches.lookup',
    'departments.lookup',
    'geo_units.lookup',
    'reference_data.lookup'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

-- tech → downgrade roster visibility from GLOBAL to his own branch.
UPDATE public.role_permission_grants rpg
SET scope_type = 'BRANCH'
FROM public.roles r, public.permissions p
WHERE rpg.role_id = r.id
  AND rpg.permission_id = p.id
  AND r.name = 'tech'
  AND p.key = 'employees.view_list'
  AND rpg.scope_type <> 'BRANCH';

COMMIT;
