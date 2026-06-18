-- ============================================================
-- 299_contracts_permission_baseline.sql
-- ============================================================
-- Contracts role baseline, decided 2026-06-17 during the contracts section
-- permission audit. Four decisions:
--
--   1. company_manager (مدير الشركة, role 7) held ZERO contracts grants — could
--      not even view the list. Grant the FULL capability set at GLOBAL (he sits
--      above the branch manager and oversees every branch). approve is excluded
--      because it is being retired (step 4).
--   2. supervisor (مشرفة, role 3) keeps view/create/edit at BRANCH but loses
--      contracts.assign_sale_owner — نسبة البيعة is a manager-level call, and the
--      self-attribution shortcut still lets her own her own demos. Closing stays
--      out of her reach (she has neither close nor approve).
--   3. branch_manager (مدير الفرع, role 6) keeps its full BRANCH set; its now-dead
--      approve grant is dropped via the CASCADE in step 4.
--   4. Retire two permissions:
--        - contracts.approve — a functional DUPLICATE of contracts.close (the
--          /approve & /reject routes accepted EITHER via OR). Consolidated onto
--          contracts.close; the routes now check close only.
--        - sales.can_close — legacy orphan from migration 001, never granted to
--          any role; the closers lookup was repointed to contracts.close.
--      Both deletes CASCADE to role_permission_grants / role_permissions, so any
--      lingering grant (e.g. branch_manager's approve) is removed automatically.
--      Also cleans up role 2 (CUSTOMER_SERVICE_SUPERVISOR, a dormant hidden
--      template) which carried close+assign with no view/create/edit.
--
-- Idempotent; joins by role NAME and permission KEY for portability.
-- ============================================================

BEGIN;

-- 1) company_manager → GLOBAL on the full contracts capability set (no approve).
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'company_manager'
  AND p.key IN (
    'contracts.view_list',
    'contracts.create',
    'contracts.edit',
    'contracts.delete',
    'contracts.close',
    'contracts.assign_sale_owner'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

-- 2) supervisor (role name 'supervisior') → drop assign_sale_owner.
DELETE FROM public.role_permission_grants g
USING public.roles r, public.permissions p
WHERE g.role_id = r.id
  AND g.permission_id = p.id
  AND r.name = 'supervisior'
  AND p.key = 'contracts.assign_sale_owner';

-- 3) CUSTOMER_SERVICE_SUPERVISOR (dormant hidden template) → drop the orphan
--    close+assign it held with no view/create/edit.
DELETE FROM public.role_permission_grants g
USING public.roles r, public.permissions p
WHERE g.role_id = r.id
  AND g.permission_id = p.id
  AND r.name = 'CUSTOMER_SERVICE_SUPERVISOR'
  AND p.key IN ('contracts.close', 'contracts.assign_sale_owner');

-- 4) Retire the duplicate/dead permissions. CASCADE removes their grants.
DELETE FROM public.permissions
WHERE key IN ('contracts.approve', 'sales.can_close');

COMMIT;
