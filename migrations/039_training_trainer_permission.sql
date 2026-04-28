-- Migration 039: training be_trainer permission
-- - Seeds jobs.training.be_trainer permission so roles can mark users as eligible trainers.
-- - Grants the permission to SYSTEM_ADMIN with GLOBAL scope.
-- - Idempotent.

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES (
  'jobs.training.be_trainer',
  'jobs',
  'training',
  'be_trainer',
  'التدريب كمدرب',
  74
)
ON CONFLICT (key) DO UPDATE
  SET module        = EXCLUDED.module,
      sub_module    = EXCLUDED.sub_module,
      action        = EXCLUDED.action,
      display_name  = EXCLUDED.display_name,
      display_order = EXCLUDED.display_order;

-- Grant to SYSTEM_ADMIN template (GLOBAL scope)
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p ON p.key = 'jobs.training.be_trainer'
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key = 'jobs.training.be_trainer'
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;
