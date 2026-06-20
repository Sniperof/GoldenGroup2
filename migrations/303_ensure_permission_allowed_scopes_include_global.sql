-- Ensure the permission-scope settings invariant matches the admin UI/API:
-- every permission catalog row must keep GLOBAL as an allowed scope.

UPDATE public.permissions
   SET allowed_scopes = ARRAY['GLOBAL'::varchar]
     || array_remove(COALESCE(allowed_scopes, ARRAY[]::varchar[]), 'GLOBAL')
 WHERE allowed_scopes IS NULL
    OR NOT ('GLOBAL' = ANY(allowed_scopes));
