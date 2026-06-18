-- ============================================================
-- 294_candidates_can_be_assigned_permission.sql
-- ============================================================
-- The candidate-names family had NO eligibility key, so the add-name modal
-- borrowed the clients one (clients.can_be_assigned) — which company_manager
-- holds, making managers wrongly appear as candidate responsibles.
--
-- Introduce candidates.can_be_assigned (eligibility only — appearing in the
-- responsible picker; NOT the right to assign). Decided 2026-06-16: eligible =
-- operational staff (supervisor, tech) at BRANCH; managers are excluded.
--
-- Mirrors candidates.name_lists.can_be_assigned. Idempotent.
-- ============================================================

BEGIN;

INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'candidates.can_be_assigned', 'candidates', 'candidates', 'can_be_assigned',
  'أهلية الإسناد للأسماء المقترحة', 96, ARRAY['GLOBAL','BRANCH']
)
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

-- Eligible: operational staff only (supervisor, tech) at BRANCH. NOT managers.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.key = 'candidates.can_be_assigned'
  AND r.name IN ('supervisior', 'tech')
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope_type = EXCLUDED.scope_type;

COMMIT;
