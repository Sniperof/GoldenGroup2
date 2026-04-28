-- ============================================================
-- Migration 043: clients.can_be_assigned permission
--
-- Adds a dedicated flag permission that controls which roles can
-- appear in the "المسؤولون عن العميل" assignment dropdown.
--
-- Why a separate permission?
-- -  `clients.view_list` (even GLOBAL scope) does NOT auto-qualify a
--    role for the dropdown.  HR_MANAGER / ACCOUNTANT / TECHNICIAN etc.
--    have view access but should not appear as assignable users.
-- -  Super admin grants this permission per-role through the Roles UI.
--
-- Initial seeding grants it to roles that operationally work with
-- client files.  Adjust freely after migration.
-- ============================================================

-- ── 1. Register the permission ────────────────────────────────────────────────
INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES (
  'clients.can_be_assigned',
  'clients',
  'clients',
  'can_be_assigned',
  'إمكانية الإسناد للزبائن',
  95
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Seed role_permission_grants ───────────────────────────────────────────
--   ADMIN, BRANCH_MANAGER, SALES, TELEMARKETER
--   Scope is GLOBAL (flag — not a data-access scope).
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p ON p.key = 'clients.can_be_assigned'
 WHERE r.is_template = TRUE
   AND r.name IN ('ADMIN', 'BRANCH_MANAGER', 'SALES', 'TELEMARKETER')
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at  = NOW();

-- ── 3. Seed role_permissions (legacy/mirror table) ───────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key = 'clients.can_be_assigned'
 WHERE r.is_template = TRUE
   AND r.name IN ('ADMIN', 'BRANCH_MANAGER', 'SALES', 'TELEMARKETER')
ON CONFLICT (role_id, permission_id) DO NOTHING;
