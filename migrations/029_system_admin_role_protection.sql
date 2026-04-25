-- ============================================================
-- Migration 029: System admin role protection (Phase Z0.1)
--
-- 1. Add protection/visibility columns to roles table:
--      is_protected    — prevents deletion via API (even by admins)
--      is_hidden       — hides from list endpoint for non-super-admins
--      protected_reason — human-readable explanation
--
-- 2. Back-fill: mark existing is_system=true roles as also
--    is_protected=true (they were already undeletable in code;
--    this makes the intent explicit in the schema).
--
-- 3. Ensure SYSTEM_ADMIN template role (INSERT or UPDATE — never ON CONFLICT
--    on name because roles.name has no unique constraint in this schema;
--    migration 020 allowed duplicate names for branch clones).
--      name          = SYSTEM_ADMIN
--      display_name  = مدير النظام
--      is_system     = true
--      is_protected  = true
--      is_hidden     = true
--      is_template   = true
--      branch_id     = NULL   (not a clone)
--      template_id   = NULL
--
-- 4. Grant SYSTEM_ADMIN every permission with GLOBAL scope.
--    Writes to both role_permission_grants (canonical) and
--    role_permissions (legacy compatibility).
--
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ── 1. Add columns ────────────────────────────────────────────────────────────

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS is_protected    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS protected_reason TEXT    NULL;

-- ── 2. Back-fill existing system roles ────────────────────────────────────────

UPDATE roles
   SET is_protected = TRUE
 WHERE is_system = TRUE
   AND is_protected = FALSE;

-- ── 3. Ensure SYSTEM_ADMIN role ───────────────────────────────────────────────
-- Cannot use ON CONFLICT (name) because roles.name has no unique constraint
-- (migration 020 creates branch clones with the same name as templates).
-- We match on name + is_template + branch_id IS NULL — the combination that
-- uniquely identifies the canonical SYSTEM_ADMIN template row.

DO $$
DECLARE
  v_id INTEGER;
BEGIN
  -- Look for an existing SYSTEM_ADMIN template (not a branch clone)
  SELECT id INTO v_id
    FROM roles
   WHERE name        = 'SYSTEM_ADMIN'
     AND is_template = TRUE
     AND branch_id   IS NULL
   LIMIT 1;

  IF v_id IS NULL THEN
    -- First run: insert the role
    INSERT INTO roles (
      name, display_name, description,
      is_system, is_active, is_template, branch_id, template_id,
      is_protected, is_hidden,
      protected_reason
    ) VALUES (
      'SYSTEM_ADMIN',
      'مدير النظام',
      'دور النظام الكامل — يملك كل الصلاحيات بنطاق GLOBAL. محمي من التعديل والحذف.',
      TRUE, TRUE, TRUE, NULL, NULL,
      TRUE, TRUE,
      'دور نظامي أساسي لا يمكن حذفه أو تعديل صلاحياته'
    );
  ELSE
    -- Subsequent runs: ensure flags are correct
    UPDATE roles
       SET display_name     = 'مدير النظام',
           is_system        = TRUE,
           is_protected     = TRUE,
           is_hidden        = TRUE,
           is_template      = TRUE,
           branch_id        = NULL,
           template_id      = NULL,
           protected_reason = 'دور نظامي أساسي لا يمكن حذفه أو تعديل صلاحياته',
           updated_at       = NOW()
     WHERE id = v_id;
  END IF;
END $$;

-- ── 4. Grant SYSTEM_ADMIN all permissions with GLOBAL scope ──────────────────

-- canonical table (read by runtime authorization)
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r, permissions p
 WHERE r.name        = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id   IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = 'GLOBAL',
      updated_at  = NOW();

-- legacy compatibility table
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name        = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id   IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── Verification query (run manually) ─────────────────────────────────────────
-- SELECT r.name, r.is_system, r.is_protected, r.is_hidden,
--        COUNT(rpg.permission_id) AS grant_count
--   FROM roles r
--   LEFT JOIN role_permission_grants rpg ON rpg.role_id = r.id
--  WHERE r.name = 'SYSTEM_ADMIN'
--    AND r.is_template = TRUE
--    AND r.branch_id IS NULL
--  GROUP BY r.id;
