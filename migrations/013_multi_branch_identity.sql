-- ============================================================
-- Migration 013: Multi-branch identity foundation
-- - Super-admin flag on hr_users
-- - branch_id on hr_users
-- - Role templates vs. per-branch role clones
-- Additive only: existing code keeps working because branch_id
-- is nullable on hr_users, and roles rows that were already
-- present stay as templates (branch_id NULL, is_template=TRUE).
-- ============================================================

-- 1. Super admin marker (independent of role name).
ALTER TABLE hr_users
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Branch binding for hr_users.
--    NULL => super admin (HQ); NOT NULL => bound to a specific branch.
ALTER TABLE hr_users
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_hr_users_branch ON hr_users(branch_id);

-- 3. Promote any existing role='ADMIN' account(s) to super admin.
UPDATE hr_users
   SET is_super_admin = TRUE
 WHERE role = 'ADMIN'
   AND is_super_admin = FALSE;

-- 4. Extend roles table for template / per-branch clone model.
ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS branch_id   INTEGER REFERENCES branches(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES roles(id)    ON DELETE SET NULL;

-- Flip the existing roles into "templates": branch_id stays NULL, is_template=TRUE.
UPDATE roles
   SET is_template = TRUE
 WHERE branch_id IS NULL
   AND is_template = FALSE;

-- 5. Scope constraint: template XOR branch clone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'roles_scope_ck'
       AND table_name      = 'roles'
  ) THEN
    ALTER TABLE roles
      ADD CONSTRAINT roles_scope_ck CHECK (
        (is_template = TRUE  AND branch_id IS NULL) OR
        (is_template = FALSE AND branch_id IS NOT NULL)
      );
  END IF;
END $$;

-- 6. Uniqueness must now include branch scope.
--    Original schema has UNIQUE on roles.name; replace with a partial-aware unique
--    index that treats NULL branch as value 0 so templates remain globally unique
--    and each branch can have its own copy named the same.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'roles_name_key'
  ) THEN
    ALTER TABLE roles DROP CONSTRAINT roles_name_key;
  END IF;
END $$;

DROP INDEX IF EXISTS roles_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS roles_name_branch_uk
  ON roles (name, COALESCE(branch_id, 0));

CREATE INDEX IF NOT EXISTS idx_roles_branch ON roles(branch_id);
