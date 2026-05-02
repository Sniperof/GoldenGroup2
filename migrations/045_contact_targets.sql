-- Migration 045: Contact targets foundation
-- Phase 1 uses marketing Lead targets only; the shape is intentionally generic
-- so later sources can attach to the same lifecycle.

CREATE TABLE IF NOT EXISTS contact_targets (
  id                       BIGSERIAL PRIMARY KEY,
  branch_id                INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  target_type              VARCHAR(50) NOT NULL CHECK (target_type IN ('client')),
  target_id                INTEGER NOT NULL,
  target_stage             VARCHAR(50) NOT NULL CHECK (target_stage IN ('lead')),
  visit_type               VARCHAR(50) NOT NULL CHECK (visit_type IN ('marketing')),
  source_type              VARCHAR(50) NOT NULL CHECK (source_type IN ('lead')),
  source_id                INTEGER NOT NULL,
  supervisor_hr_user_id    INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  zone_id                  INTEGER,
  status                   VARCHAR(50) NOT NULL DEFAULT 'new'
                             CHECK (status IN ('new', 'queued', 'in_call_list', 'contacted', 'booked', 'closed', 'cancelled')),
  latest_call_outcome      VARCHAR(50),
  latest_task_list_item_id INTEGER,
  latest_appointment_id    INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_contact_targets_dedupe
    UNIQUE (branch_id, target_type, target_id, visit_type, source_type)
);

CREATE INDEX IF NOT EXISTS idx_contact_targets_branch_status
  ON contact_targets(branch_id, status);

CREATE INDEX IF NOT EXISTS idx_contact_targets_supervisor
  ON contact_targets(supervisor_hr_user_id);

CREATE INDEX IF NOT EXISTS idx_contact_targets_source
  ON contact_targets(source_type, source_id);
