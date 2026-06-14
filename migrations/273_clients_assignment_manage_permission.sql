-- ============================================================
-- 273_clients_assignment_manage_permission.sql
-- ============================================================
-- Adds an explicit client ownership/assignment management permission.
--
-- clients.assignment.manage controls who may set or change the users
-- responsible for a client. It is intentionally separate from:
--   - clients.edit: edit client data
--   - clients.can_be_assigned: eligibility to appear as an assignee
--
-- Scope model:
--   GLOBAL: can assign clients in any branch
--   BRANCH: can assign clients only inside allowed branches
--   ASSIGNED: not allowed for this permission
-- ============================================================

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  (
    'clients.assignment.manage',
    'clients',
    'assignment',
    'assignment_manage',
    'إدارة مسؤولي الزبون',
    96,
    ARRAY['GLOBAL','BRANCH']
  )
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

WITH permission_row AS (
  SELECT id FROM public.permissions WHERE key = 'clients.assignment.manage'
),
role_grants AS (
  SELECT r.id AS role_id, p.id AS permission_id, 'GLOBAL'::varchar AS scope_type
    FROM public.roles r
    CROSS JOIN permission_row p
   WHERE r.name IN ('SYSTEM_ADMIN', 'DEV_GLOBAL_ADMIN')
  UNION ALL
  SELECT r.id AS role_id, p.id AS permission_id, 'BRANCH'::varchar AS scope_type
    FROM public.roles r
    CROSS JOIN permission_row p
   WHERE r.name IN ('BRANCH_MANAGER', 'DEV_BRANCH_USER')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT role_id, permission_id, scope_type FROM role_grants
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

COMMIT;
