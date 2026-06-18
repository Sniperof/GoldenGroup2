-- ============================================================
-- 293_candidates_role_baseline_grants.sql
-- ============================================================
-- Individual candidate names (candidates.*) role baseline, decided 2026-06-16
-- alongside the name-lists audit:
--  - branch_manager: held NO candidates.* grant (could manage the sheet but not
--    the names inside it). Grant full BRANCH, matching his name-lists baseline.
--  - company_manager: candidates.delete was GLOBAL, broader than the clients /
--    name-lists parity (delete = BRANCH). Align it to BRANCH.
--
-- Idempotent; joins by role NAME and permission KEY for portability.
-- ============================================================

BEGIN;

-- branch_manager → full BRANCH on the candidate-names family.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'branch_manager'
  AND p.key IN (
    'candidates.view_list',
    'candidates.create',
    'candidates.edit',
    'candidates.delete'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

-- company_manager → align delete to BRANCH (clients/name-lists parity).
UPDATE public.role_permission_grants rpg
SET scope_type = 'BRANCH'
FROM public.roles r, public.permissions p
WHERE rpg.role_id = r.id
  AND rpg.permission_id = p.id
  AND r.name = 'company_manager'
  AND p.key = 'candidates.delete'
  AND rpg.scope_type <> 'BRANCH';

COMMIT;
