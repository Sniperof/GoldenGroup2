-- 343_client_rating_history.sql
-- Historical client commitment rating with dedicated permissions.

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_rating_history (
  id          SERIAL PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  old_rating  VARCHAR(50),
  new_rating  VARCHAR(50) NOT NULL,
  notes       TEXT,
  changed_by  INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_rating_history_old_rating_check
    CHECK (old_rating IS NULL OR old_rating IN ('Committed', 'NotCommitted', 'Undefined')),
  CONSTRAINT client_rating_history_new_rating_check
    CHECK (new_rating IN ('Committed', 'NotCommitted', 'Undefined'))
);

CREATE INDEX IF NOT EXISTS idx_client_rating_history_client_time
  ON public.client_rating_history (client_id, changed_at DESC);

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('clients.rating.view', 'clients', 'profile_rating', 'view', 'عرض سجل تقييم التزام الزبون', 74, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
    ('clients.rating.edit', 'clients', 'profile_rating', 'edit', 'تعديل تقييم التزام الزبون', 75, ARRAY['GLOBAL','BRANCH','ASSIGNED'])
)
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
SELECT key, module, sub_module, action, display_name, display_order, allowed_scopes
FROM source_permissions
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

WITH current_rows AS (
  SELECT c.id, COALESCE(c.rating, 'Undefined') AS rating, c.created_by, c.created_at
  FROM public.clients c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.client_rating_history h
    WHERE h.client_id = c.id
  )
)
INSERT INTO public.client_rating_history (client_id, old_rating, new_rating, notes, changed_by, changed_at)
SELECT id, NULL, rating, 'ترحيل التقييم الحالي إلى السجل التاريخي', created_by, COALESCE(created_at, NOW())
FROM current_rows
WHERE rating IN ('Committed', 'NotCommitted', 'Undefined');

WITH view_permission AS (
  SELECT id FROM public.permissions WHERE key = 'clients.rating.view'
),
edit_permission AS (
  SELECT id FROM public.permissions WHERE key = 'clients.rating.edit'
),
source_view_grants AS (
  SELECT role_id, scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'clients.view'
),
source_edit_grants AS (
  SELECT role_id, scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'clients.edit'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT role_id, (SELECT id FROM view_permission), scope_type FROM source_view_grants
UNION ALL
SELECT role_id, (SELECT id FROM edit_permission), scope_type FROM source_edit_grants
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

COMMIT;
