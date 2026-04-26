-- ============================================================
-- Migration 035: Role job tasks
-- Stores manual job-task definitions on the administrative role.
-- Employee detail pages read tasks from the assigned role_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS role_job_tasks (
  id SERIAL PRIMARY KEY,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_job_tasks_role_id
  ON role_job_tasks(role_id, display_order, id);
