-- ============================================================
-- 295_company_manager_reference_data_lookup.sql
-- ============================================================
-- The company_manager (GLOBAL deputy) was missing reference_data.lookup, so the
-- shared reference lists (occupations, water sources, …) returned 403 and the
-- add forms showed empty dropdowns. Reference lists are general read data needed
-- by anyone filling a form (acceptance criteria §8), and the deputy operates
-- company-wide — grant it at GLOBAL, matching his other form lookups.
--
-- Idempotent; joins by role name and permission key.
-- ============================================================

BEGIN;

INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'company_manager'
  AND p.key = 'reference_data.lookup'
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

COMMIT;
