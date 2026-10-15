-- ============================================================
-- 468_split_supervisor_telemarketer_contact_visibility.sql
-- ============================================================
-- Enforce the intended mutually-exclusive contact-list visibility baseline:
--   * customer_service_supervisor: only contacts that contain a device-demo
--     task, limited to the supervisor's assigned subject/team.
--   * telemarkter: all contacts in the permitted branch/team.
--
-- The task-type permission is an alternative to the broad permission, never an
-- additional grant. Joins use role names and permission keys for portability.
-- Idempotent and safe to re-run.
-- ============================================================

BEGIN;

-- Customer-service supervisor: restricted device-demo contact visibility only.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'ASSIGNED'
  FROM public.roles r
 CROSS JOIN public.permissions p
 WHERE r.name = 'customer_service_supervisor'
   AND p.key = 'telemarketing.lists.view_device_demo'
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

DELETE FROM public.role_permission_grants grant_row
USING public.roles r, public.permissions p
WHERE grant_row.role_id = r.id
  AND grant_row.permission_id = p.id
  AND r.name = 'customer_service_supervisor'
  AND p.key = 'telemarketing.lists.view';

-- Telemarketer: broad contact visibility within the saved branch/team subject.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM public.roles r
 CROSS JOIN public.permissions p
 WHERE r.name = 'telemarkter'
   AND p.key = 'telemarketing.lists.view'
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

DELETE FROM public.role_permission_grants grant_row
USING public.roles r, public.permissions p
WHERE grant_row.role_id = r.id
  AND grant_row.permission_id = p.id
  AND r.name = 'telemarkter'
  AND p.key = 'telemarketing.lists.view_device_demo';

COMMIT;
