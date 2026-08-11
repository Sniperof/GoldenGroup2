BEGIN;

-- DEF-032: the visit-management surface is branch/global only. Personal access
-- lives behind field_visits.my_visits.view and must remain team-assigned.
UPDATE public.permissions
   SET allowed_scopes = CASE key
     WHEN 'field_visits.my_visits.view' THEN ARRAY['ASSIGNED']::text[]
     ELSE ARRAY['GLOBAL', 'BRANCH']::text[]
   END
 WHERE key IN (
   'field_visits.view',
   'field_visits.edit',
   'field_visits.my_visits.view'
 );

-- Fail closed: do not promote an invalid ASSIGNED management grant to BRANCH,
-- because that would expose the whole branch. Likewise remove any non-personal
-- grant from the dedicated "my visits" capability.
DELETE FROM public.role_permission_grants rpg
 USING public.permissions p
 WHERE p.id = rpg.permission_id
   AND (
     (
       p.key IN ('field_visits.view', 'field_visits.edit')
       AND rpg.scope_type NOT IN ('GLOBAL', 'BRANCH')
     )
     OR (
       p.key = 'field_visits.my_visits.view'
       AND rpg.scope_type <> 'ASSIGNED'
     )
   );

COMMIT;
