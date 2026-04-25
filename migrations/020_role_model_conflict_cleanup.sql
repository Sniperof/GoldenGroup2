-- ============================================================
-- Migration 020: Resolve role model conflict
-- - Redirect hr_users.role_id from branch clones to template roles
-- - Tighten user_branch_assignments constraints
-- - Ensure branch role cloning copies role_permission_grants
-- ============================================================

-- ---------------------------------------------------------------------------
-- Redirect security role references to template roles only.
-- Assumption: when a branch clone is linked to a template via template_id,
-- hr_users.role_id should point to the template for capability identity.
-- ---------------------------------------------------------------------------
UPDATE hr_users u
   SET role_id = r.template_id
  FROM roles r
  JOIN roles t
    ON t.id = r.template_id
 WHERE u.role_id = r.id
   AND r.is_template = FALSE
   AND r.template_id IS NOT NULL
   AND t.is_template = TRUE;

-- ---------------------------------------------------------------------------
-- Tighten user_branch_assignments without changing runtime read paths.
-- ---------------------------------------------------------------------------
UPDATE user_branch_assignments
   SET status = 'active'
 WHERE status IS NULL
    OR status NOT IN ('active', 'inactive');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'user_branch_assignments_status_ck'
       AND conrelid = 'user_branch_assignments'::regclass
  ) THEN
    ALTER TABLE user_branch_assignments
      ADD CONSTRAINT user_branch_assignments_status_ck CHECK (
        status IN ('active', 'inactive')
      );
  END IF;
END $$;

WITH ranked_primary AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) AS row_num
    FROM user_branch_assignments
   WHERE is_primary = TRUE
)
UPDATE user_branch_assignments uba
   SET is_primary = FALSE,
       updated_at = NOW()
  FROM ranked_primary rp
 WHERE uba.id = rp.id
   AND rp.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_branch_assignments_one_primary_per_user
  ON user_branch_assignments(user_id)
  WHERE is_primary = TRUE;

-- ---------------------------------------------------------------------------
-- Keep branch role clone seeding structurally complete by copying grants too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION clone_role_templates_to_branch(target_branch INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  tmpl     RECORD;
  new_id   INTEGER;
  cloned   INTEGER := 0;
BEGIN
  FOR tmpl IN
    SELECT id, name, display_name, description, is_system, is_active
      FROM roles
     WHERE is_template = TRUE
  LOOP
    IF EXISTS (
      SELECT 1 FROM roles
       WHERE branch_id = target_branch
         AND name      = tmpl.name
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO roles (
      name, display_name, description, is_system, is_active,
      branch_id, is_template, template_id
    )
    VALUES (
      tmpl.name, tmpl.display_name, tmpl.description, tmpl.is_system, tmpl.is_active,
      target_branch, FALSE, tmpl.id
    )
    RETURNING id INTO new_id;

    INSERT INTO role_permissions (role_id, permission_id)
    SELECT new_id, rp.permission_id
      FROM role_permissions rp
     WHERE rp.role_id = tmpl.id
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
    SELECT new_id, rpg.permission_id, rpg.scope_type
      FROM role_permission_grants rpg
     WHERE rpg.role_id = tmpl.id
    ON CONFLICT (role_id, permission_id) DO UPDATE
      SET scope_type = EXCLUDED.scope_type,
          updated_at = NOW();

    cloned := cloned + 1;
  END LOOP;

  RETURN cloned;
END;
$$;
