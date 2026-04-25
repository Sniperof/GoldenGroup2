-- Migration 032: interview interviewer assignment + conduct permission
-- - Adds interviewer_user_id to interviews for secure user-backed assignment.
-- - Seeds jobs.interviews.conduct permission.
-- - Grants the permission to SYSTEM_ADMIN with GLOBAL scope only.
-- - Idempotent.

ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS interviewer_user_id INTEGER REFERENCES hr_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_interviews_interviewer_user_id
  ON interviews(interviewer_user_id);

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES (
  'jobs.interviews.conduct',
  'jobs',
  'interviews',
  'conduct',
  'إجراء المقابلات',
  52
)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      sub_module = EXCLUDED.sub_module,
      action = EXCLUDED.action,
      display_name = EXCLUDED.display_name,
      display_order = EXCLUDED.display_order;

INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p ON p.key = 'jobs.interviews.conduct'
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key = 'jobs.interviews.conduct'
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;
