-- ============================================================
-- Migration 019: Authorization schema preparation
-- - Adds user_branch_assignments as the new source of truth for branch access
-- - Adds role_permission_grants as the new source of truth for permission scope
-- - Backfills conservatively from hr_users.branch_id and role_permissions
-- ============================================================

-- ---------------------------------------------------------------------------
-- user_branch_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_branch_assignments (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES hr_users(id) ON DELETE CASCADE,
  branch_id  INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  status     VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_user_branch_assignments_user_id
  ON user_branch_assignments(user_id);

CREATE INDEX IF NOT EXISTS idx_user_branch_assignments_branch_id
  ON user_branch_assignments(branch_id);

-- Conservative backfill from legacy/primary branch column.
INSERT INTO user_branch_assignments (user_id, branch_id, is_primary, status)
SELECT u.id, u.branch_id, TRUE, 'active'
  FROM hr_users u
 WHERE u.branch_id IS NOT NULL
ON CONFLICT (user_id, branch_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- role_permission_grants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permission_grants (
  id            SERIAL PRIMARY KEY,
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  scope_type    VARCHAR(16) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_id, permission_id),
  CONSTRAINT role_permission_grants_scope_type_ck CHECK (
    scope_type IN ('GLOBAL', 'BRANCH', 'ASSIGNED')
  )
);

CREATE INDEX IF NOT EXISTS idx_role_permission_grants_role_id
  ON role_permission_grants(role_id);

CREATE INDEX IF NOT EXISTS idx_role_permission_grants_permission_id
  ON role_permission_grants(permission_id);

-- PHASE2_REQUIRED: scope_type defaults to GLOBAL during migration backfill
-- and will be refined role-by-role in later phases.
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT rp.role_id, rp.permission_id, 'GLOBAL'
  FROM role_permissions rp
ON CONFLICT (role_id, permission_id) DO NOTHING;
