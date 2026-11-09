-- 491: Own permission for the client lifecycle tab (2026-11-02)
--
-- «دورة الحياة» (GET /clients/:id/lifecycle) was gated by clients.view, with
-- each category inside following its own tab's permission. Every other profile
-- tab has its own key (ownership, network, activity log), so an admin could
-- not hide this one from a role. Decisions:
--   D1  new clients.lifecycle.view, same scopes as clients.view (GLOBAL /
--       BRANCH / ASSIGNED — an ASSIGNED holder sees it on its own clients).
--   D2  granted to every current holder of clients.view WITH THE SAME SCOPE,
--       so nobody gains or loses anything the day it is applied.
--   D3  the per-category gating inside the timeline is unchanged.

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('clients.lifecycle.view', 'clients', 'profile_lifecycle', 'view',
   'عرض دورة حياة الزبون', 76, ARRAY['GLOBAL','BRANCH','ASSIGNED'])
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT g.role_id, lifecycle_perm.id, g.scope_type
  FROM public.role_permission_grants g
  JOIN public.permissions view_perm ON view_perm.id = g.permission_id
                                   AND view_perm.key = 'clients.view'
 CROSS JOIN (SELECT id FROM public.permissions WHERE key = 'clients.lifecycle.view') lifecycle_perm
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
