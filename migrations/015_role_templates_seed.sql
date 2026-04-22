-- ============================================================
-- Migration 015: Role template helpers + initial clone seeding
-- ============================================================

-- Helper function: clone every role-template (and its permissions)
-- into a specific branch. Idempotent: skips template names that
-- already exist for that branch.
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
    -- Skip if a role with the same name already exists for this branch.
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
     WHERE rp.role_id = tmpl.id;

    cloned := cloned + 1;
  END LOOP;

  RETURN cloned;
END;
$$;

-- Seed: clone templates into every existing branch.
DO $$
DECLARE
  br RECORD;
BEGIN
  FOR br IN SELECT id FROM branches LOOP
    PERFORM clone_role_templates_to_branch(br.id);
  END LOOP;
END $$;
