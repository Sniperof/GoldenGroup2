-- ============================================================
-- 385_employee_direct_manager_eligibility.sql
-- ============================================================
-- ENH-027: direct-manager candidacy is role-configured eligibility, not a
-- textual inference from role display names or employee job titles.
--
-- These keys do NOT authorize an operation:
--   - direct_manager_eligible: eligible inside the employee's department.
--   - direct_manager_branch_fallback: eligible across departments, but only
--     inside the employee's branch.
--
-- Baseline:
--   - company_manager  -> department eligibility (GLOBAL).
--   - branch_manager   -> branch fallback eligibility (BRANCH).
-- Other department-manager roles are deliberately configured through the role
-- permissions UI; shared operational roles are not auto-promoted from one
-- employee's job title.
-- ============================================================

BEGIN;

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    (
      'employees.direct_manager_eligible',
      'employees',
      'lookups',
      'direct_manager_eligible',
      'أهلية الاختيار كمدير مباشر للقسم',
      97,
      ARRAY['GLOBAL','BRANCH']
    ),
    (
      'employees.direct_manager_branch_fallback',
      'employees',
      'lookups',
      'direct_manager_branch_fallback',
      'أهلية الظهور كمدير بديل على مستوى الفرع',
      98,
      ARRAY['GLOBAL','BRANCH']
    )
)
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
SELECT key, module, sub_module, action, display_name, display_order, allowed_scopes
FROM source_permissions
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

WITH baseline_grants(role_name, permission_key, scope_type) AS (
  VALUES
    ('company_manager', 'employees.direct_manager_eligible', 'GLOBAL'),
    ('branch_manager', 'employees.direct_manager_branch_fallback', 'BRANCH')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, bg.scope_type
FROM baseline_grants bg
JOIN public.roles r ON LOWER(r.name) = bg.role_name
JOIN public.permissions p ON p.key = bg.permission_key
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type;

COMMIT;
