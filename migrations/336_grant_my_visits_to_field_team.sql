BEGIN;

-- "زياراتي" is a personal ASSIGNED surface. Grant it to operational field roles
-- without granting field_visits.view, so supervisors/technicians do not gain the
-- branch visit-management page just to see their own team visits.
WITH target_permission AS (
  SELECT id
    FROM public.permissions
   WHERE key = 'field_visits.my_visits.view'
),
target_roles AS (
  SELECT id
    FROM public.roles
   WHERE is_active = TRUE
     AND team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type, created_at, updated_at)
SELECT r.id, p.id, 'ASSIGNED', NOW(), NOW()
  FROM target_roles r
 CROSS JOIN target_permission p
ON CONFLICT (role_id, permission_id) DO UPDATE
   SET scope_type = 'ASSIGNED',
       updated_at = NOW();

COMMIT;
