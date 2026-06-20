-- ============================================================
-- 304_departments_group1_branch_baseline.sql
-- ============================================================
-- Promote «الأقسام» (departments) to a Group-1 operational section (branch-scope
-- standard §6/§7) — branch managers manage their own branch's departments, the
-- same way they own clients/employees on their branch. Decided 2026-06-20.
--
-- Before this migration only SYSTEM_ADMIN and company_manager held
-- departments.view_list / departments.manage (both GLOBAL): departments were
-- effectively CENTRAL-only even though the table is branch-owned. That contradicts
-- the "departments resemble client records" goal.
--
-- Capability framing (behaviour follows the GRANTED SCOPE, not identity):
--   departments.view_list  عرض/إدارة قائمة الأقسام        {GLOBAL,BRANCH}
--   departments.manage     إنشاء/تعديل/حذف القسم          {GLOBAL,BRANCH}
--   departments.lookup     منتقي القسم في الفورمات         {GLOBAL,BRANCH,ASSIGNED}  (موجود مسبقاً)
--
-- Decision:
--   - branch_manager → departments.view_list + departments.manage at BRANCH.
--     (Already holds departments.lookup BRANCH + devices.department_availability.view
--      BRANCH; the PUT route splits department-field edits from device-availability
--      assignment, so device-model assignment stays a central act — branch_manager
--      keeps .view only, NOT .manage, of department device availability.)
--   - company_manager / SYSTEM_ADMIN → unchanged (already GLOBAL).
--   - supervisors → unchanged (lookup BRANCH only — pickers, not management;
--     departments are not an ASSIGNED entity).
--
-- Idempotent; joins by role NAME and permission KEY. ON CONFLICT DO UPDATE so the
-- scope is corrected on re-run.
-- ============================================================

BEGIN;

-- branch_manager → BRANCH management of its own branch's departments.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'branch_manager'
  AND p.key IN (
    'departments.view_list',
    'departments.manage'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

COMMIT;
