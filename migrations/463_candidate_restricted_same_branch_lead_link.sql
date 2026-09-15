-- Allow an assigned candidate supervisor to claim and link one hidden LEAD
-- only when an exact phone match exists inside the candidate's own branch.
BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'candidates.link_restricted_lead',
  'candidates',
  'candidates',
  'link_restricted_lead',
  'ربط زبون Lead مقيّد ضمن الفرع',
  98,
  ARRAY['GLOBAL','BRANCH','ASSIGNED']
)
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'ASSIGNED'
  FROM public.roles r
 CROSS JOIN public.permissions p
 WHERE r.name = 'customer_service_supervisor'
   AND p.key = 'candidates.link_restricted_lead'
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

COMMIT;
