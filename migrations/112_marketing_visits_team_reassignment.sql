-- Migration 112: Team reassignment for marketing visits
-- Allows reassigning a visit to a different team while preserving the original team record.
-- The reassigned team overrides display/access; the original team stays for audit.

ALTER TABLE marketing_visits
  ADD COLUMN IF NOT EXISTS reassigned_supervisor_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassigned_technician_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassigned_trainee_id     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassigned_team_snapshot  JSONB,
  ADD COLUMN IF NOT EXISTS reassigned_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reassigned_by             INTEGER REFERENCES hr_users(id) ON DELETE SET NULL;
