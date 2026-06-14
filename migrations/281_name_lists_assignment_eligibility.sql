-- ============================================================
-- 281_name_lists_assignment_eligibility.sql
-- ============================================================
-- Mirror the client assignment model for name lists (referral sheets):
--   candidates.name_lists.can_be_assigned  — ELIGIBILITY: marks staff who may be
--       made the responsible owner of a name list (appears in the "assign to"
--       list). Does NOT grant the ability to assign.
--   candidates.name_lists.assignment.manage — OPERATION: who may set/change the
--       responsible HR user on a name list (separate from .edit).
--
-- Baseline (mirrors clients): eligibility ← roles holding clients.can_be_assigned;
-- assignment ← roles holding clients.assignment.manage; plus branch_manager gets
-- assignment at BRANCH. Grants stay freely editable per role via the roles UI.
--
-- Idempotent / safe to re-run.
-- ============================================================

BEGIN;

INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('candidates.name_lists.can_be_assigned', 'candidates', 'name_lists', 'can_be_assigned',
    'أهلية إسناد سجلات الأسماء', 210, ARRAY['GLOBAL','BRANCH']),
  ('candidates.name_lists.assignment.manage', 'candidates', 'name_lists', 'assignment_manage',
    'إسناد سجلات الأسماء للموظفين', 211, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

-- Baseline: eligibility mirrors clients.can_be_assigned (same role, same scope).
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT src.role_id, tgt.id, src.scope_type
FROM (
  SELECT rpg.role_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'clients.can_be_assigned'
) src
CROSS JOIN (SELECT id FROM public.permissions WHERE key = 'candidates.name_lists.can_be_assigned') tgt
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Baseline: assignment mirrors clients.assignment.manage (same role, same scope).
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT src.role_id, tgt.id, src.scope_type
FROM (
  SELECT rpg.role_id, rpg.scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'clients.assignment.manage'
) src
CROSS JOIN (SELECT id FROM public.permissions WHERE key = 'candidates.name_lists.assignment.manage') tgt
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Branch manager also distributes name lists within their branch.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'branch_manager' AND r.is_template = TRUE
  AND p.key = 'candidates.name_lists.assignment.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
