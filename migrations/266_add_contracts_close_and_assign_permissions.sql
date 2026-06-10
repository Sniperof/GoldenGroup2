-- ============================================================
-- 266_add_contracts_close_and_assign_permissions.sql
-- ============================================================
-- Plan ref: docs/constitution/plans/2026-06-10-contract-form-fixes.md §الجزء 5
--
-- Adds two new permissions split out of the previously-overloaded
-- contracts.create / contracts.edit grants:
--
--   contracts.close              — assigning the closing_employee (تسكير)
--                                  and approving a draft contract to active.
--   contracts.assign_sale_owner  — attributing a sale to an employee other
--                                  than the data-entry user (نسبة البيعة).
--
-- Default grants are conservative — SYSTEM_ADMIN gets both globally,
-- BRANCH_MANAGER and CUSTOMER_SERVICE_SUPERVISOR get both at branch
-- scope. Product owner may adjust grants later via the roles UI.
--
-- Idempotent via ON CONFLICT (key) DO NOTHING on permissions and
-- ON CONFLICT (role_id, permission_id) DO NOTHING on grants.
-- ============================================================

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('contracts.close', 'contracts', 'contracts', 'close',
   'تسكير العقد واعتماده', 33, ARRAY['GLOBAL','BRANCH']),

  ('contracts.assign_sale_owner', 'contracts', 'contracts', 'assign_sale_owner',
   'نسبة البيعة لموظف آخر', 25, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO NOTHING;

-- Default grants — adjust via admin UI as needed.
WITH new_perms AS (
  SELECT id, key FROM public.permissions
   WHERE key IN ('contracts.close', 'contracts.assign_sale_owner')
),
role_grants AS (
  -- SYSTEM_ADMIN: both, GLOBAL
  SELECT 1 AS role_id, p.id AS permission_id, 'GLOBAL'::varchar AS scope_type FROM new_perms p
  UNION ALL
  -- CUSTOMER_SERVICE_SUPERVISOR: both, BRANCH
  SELECT 2, p.id, 'BRANCH' FROM new_perms p
  UNION ALL
  -- branch_manager (id=3): both, BRANCH
  SELECT 3, p.id, 'BRANCH' FROM new_perms p
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT role_id, permission_id, scope_type FROM role_grants
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
