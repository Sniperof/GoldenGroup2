-- ============================================================
-- Migration 119: add resolve escalation permission for recruitment applications
-- - Seeds jobs.applications.resolve_escalation
-- - Grants it to SYSTEM_ADMIN (GLOBAL) and branch_manager (BRANCH)
-- - Idempotent
-- ============================================================

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'jobs.applications.resolve_escalation',
  'jobs',
  'applications',
  'resolve_escalation',
  'فك تصعيد طلب التوظيف',
  40,
  ARRAY['GLOBAL', 'BRANCH']
)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      sub_module = EXCLUDED.sub_module,
      action = EXCLUDED.action,
      display_name = EXCLUDED.display_name,
      display_order = EXCLUDED.display_order,
      allowed_scopes = EXCLUDED.allowed_scopes;

-- Grant to SYSTEM_ADMIN template role (GLOBAL scope)
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p ON p.key = 'jobs.applications.resolve_escalation'
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

-- Grant to branch_manager template role (BRANCH scope)
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key = 'jobs.applications.resolve_escalation'
 WHERE r.name = 'branch_manager'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();
