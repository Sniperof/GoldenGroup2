BEGIN;

-- Operations and task tables are branch/global scoped only. Personal/assigned
-- task pages will be implemented as filtered views on top of the same branch/global gates.
WITH operations_task_permissions(key) AS (
  VALUES
    ('open_tasks.view'),
    ('open_tasks.edit'),
    ('field_visits.view'),
    ('field_visits.edit'),
    ('tasks.view_list'),
    ('tasks.create'),
    ('tasks.edit'),
    ('tasks.delete'),
    ('tasks.delivery.view'),
    ('tasks.delivery.create'),
    ('tasks.delivery.result'),
    ('tasks.installation.view'),
    ('tasks.installation.create'),
    ('tasks.installation.result'),
    ('tasks.activation.create')
)
UPDATE public.permissions p
   SET allowed_scopes = ARRAY['GLOBAL','BRANCH']::text[]
  FROM operations_task_permissions otp
 WHERE p.key = otp.key;

WITH operations_task_permissions(key) AS (
  VALUES
    ('open_tasks.view'),
    ('open_tasks.edit'),
    ('field_visits.view'),
    ('field_visits.edit'),
    ('tasks.view_list'),
    ('tasks.create'),
    ('tasks.edit'),
    ('tasks.delete'),
    ('tasks.delivery.view'),
    ('tasks.delivery.create'),
    ('tasks.delivery.result'),
    ('tasks.installation.view'),
    ('tasks.installation.create'),
    ('tasks.installation.result'),
    ('tasks.activation.create')
)
DELETE FROM public.role_permission_grants rpg
  USING public.permissions p,
        operations_task_permissions otp
 WHERE rpg.permission_id = p.id
   AND otp.key = p.key
   AND rpg.scope_type = 'ASSIGNED'
   AND EXISTS (
     SELECT 1
       FROM public.role_permission_grants existing
      WHERE existing.role_id = rpg.role_id
        AND existing.permission_id = rpg.permission_id
        AND existing.scope_type IN ('GLOBAL', 'BRANCH')
   );

WITH operations_task_permissions(key) AS (
  VALUES
    ('open_tasks.view'),
    ('open_tasks.edit'),
    ('field_visits.view'),
    ('field_visits.edit'),
    ('tasks.view_list'),
    ('tasks.create'),
    ('tasks.edit'),
    ('tasks.delete'),
    ('tasks.delivery.view'),
    ('tasks.delivery.create'),
    ('tasks.delivery.result'),
    ('tasks.installation.view'),
    ('tasks.installation.create'),
    ('tasks.installation.result'),
    ('tasks.activation.create')
)
UPDATE public.role_permission_grants rpg
   SET scope_type = 'BRANCH',
       updated_at = NOW()
  FROM public.permissions p
  JOIN operations_task_permissions otp ON otp.key = p.key
 WHERE rpg.permission_id = p.id
   AND rpg.scope_type = 'ASSIGNED';

COMMIT;
