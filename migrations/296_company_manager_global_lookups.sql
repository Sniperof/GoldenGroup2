-- ============================================================
-- 296_company_manager_global_lookups.sql
-- ============================================================
-- The company_manager (GLOBAL deputy) had form-lookup grants at BRANCH while his
-- operational data scope is GLOBAL — so reference pickers (branch names, dept
-- names) were limited to his assigned branches across the whole project (e.g.
-- the "الفرع #2" unresolved-name symptom). Align his reference lookups to GLOBAL
-- to match his company-wide scope. (reference_data.lookup was granted in 295;
-- geo_units.lookup / employees.lookup are already GLOBAL.)
--
-- Idempotent; joins by role name and permission key.
-- ============================================================

BEGIN;

INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'company_manager'
  AND p.key IN ('branches.lookup', 'departments.lookup', 'reference_data.lookup')
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = 'GLOBAL';

COMMIT;
