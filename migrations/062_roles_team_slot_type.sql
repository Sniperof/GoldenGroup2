-- 062: Add team_slot_type to roles for explicit team-slot eligibility
-- Replaces brittle job-title text inference (deriveEmployeeRoleFromVacancyTitle)
-- for planning/scheduling purposes.

ALTER TABLE roles ADD COLUMN IF NOT EXISTS team_slot_type TEXT NULL;

ALTER TABLE roles DROP CONSTRAINT IF EXISTS chk_roles_team_slot_type;
ALTER TABLE roles ADD CONSTRAINT chk_roles_team_slot_type
  CHECK (team_slot_type IN ('SUPERVISOR', 'TECHNICIAN', 'TRAINEE', 'TELEMARKETER'));

-- Conservative backfill: only update when intent is unambiguous from name/display_name.
-- Roles not matching any pattern are left NULL (not eligible for team scheduling).

UPDATE roles SET team_slot_type = 'SUPERVISOR'
WHERE is_template = TRUE
  AND team_slot_type IS NULL
  AND (
    LOWER(name)         LIKE '%supervisor%'
    OR LOWER(display_name) LIKE '%مشرف%'
  );

UPDATE roles SET team_slot_type = 'TECHNICIAN'
WHERE is_template = TRUE
  AND team_slot_type IS NULL
  AND (
    LOWER(name)         LIKE '%technician%'
    OR LOWER(display_name) LIKE '%فني%'
  );

UPDATE roles SET team_slot_type = 'TRAINEE'
WHERE is_template = TRUE
  AND team_slot_type IS NULL
  AND (
    LOWER(name)         LIKE '%trainee%'
    OR LOWER(display_name) LIKE '%متدرب%'
  );

UPDATE roles SET team_slot_type = 'TELEMARKETER'
WHERE is_template = TRUE
  AND team_slot_type IS NULL
  AND (
    LOWER(name)         LIKE '%telemarketer%'
    OR LOWER(display_name) LIKE '%مسوق%'
  );
