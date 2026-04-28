-- Migration 042: Many-to-many assignment tables for clients and candidates
-- Replaces the single assigned_hr_user_id / owner_user_id columns as the
-- source-of-truth for the ASSIGNED permission scope.

-- ── client_assignments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_assignments (
  id          SERIAL PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id)   ON DELETE CASCADE,
  hr_user_id  INTEGER NOT NULL REFERENCES hr_users(id)  ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by INTEGER          REFERENCES hr_users(id)  ON DELETE SET NULL,
  UNIQUE (client_id, hr_user_id)
);

CREATE INDEX IF NOT EXISTS idx_client_assignments_client ON client_assignments(client_id);
CREATE INDEX IF NOT EXISTS idx_client_assignments_user   ON client_assignments(hr_user_id);

-- Backfill from the legacy single-assignment column
-- Guard: skip rows whose assigned_hr_user_id no longer exists in hr_users
INSERT INTO client_assignments (client_id, hr_user_id, assigned_by)
SELECT id,
       assigned_hr_user_id,
       NULL  -- created_by backfill handled separately in migration 041
  FROM clients
 WHERE assigned_hr_user_id IS NOT NULL
   AND assigned_hr_user_id IN (SELECT id FROM hr_users)
ON CONFLICT (client_id, hr_user_id) DO NOTHING;

-- ── candidate_assignments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_assignments (
  id           SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  hr_user_id   INTEGER NOT NULL REFERENCES hr_users(id)   ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ DEFAULT NOW(),
  assigned_by  INTEGER          REFERENCES hr_users(id)   ON DELETE SET NULL,
  UNIQUE (candidate_id, hr_user_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_assignments_candidate ON candidate_assignments(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_assignments_user      ON candidate_assignments(hr_user_id);

-- Backfill from owner_user_id
-- Guard: skip rows whose owner_user_id no longer exists in hr_users
INSERT INTO candidate_assignments (candidate_id, hr_user_id, assigned_by)
SELECT id,
       owner_user_id,
       CASE WHEN created_by IN (SELECT id FROM hr_users) THEN created_by ELSE NULL END
  FROM candidates
 WHERE owner_user_id IS NOT NULL
   AND owner_user_id IN (SELECT id FROM hr_users)
ON CONFLICT (candidate_id, hr_user_id) DO NOTHING;
