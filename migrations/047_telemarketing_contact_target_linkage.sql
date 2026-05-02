-- Migration 047: Telemarketing contact target linkage
-- Adds contact_target_id FK to three telemarketing tables and fixes lifecycle id
-- column types in contact_targets to match the VARCHAR(100) PKs of those tables.

-- 1. Add nullable contact_target_id columns to telemarketing tables
ALTER TABLE telemarketing_task_list_items
  ADD COLUMN IF NOT EXISTS contact_target_id BIGINT REFERENCES contact_targets(id) ON DELETE SET NULL;

ALTER TABLE telemarketing_call_logs
  ADD COLUMN IF NOT EXISTS contact_target_id BIGINT REFERENCES contact_targets(id) ON DELETE SET NULL;

ALTER TABLE telemarketing_appointments
  ADD COLUMN IF NOT EXISTS contact_target_id BIGINT REFERENCES contact_targets(id) ON DELETE SET NULL;

-- 2. Add indexes for contact_target_id lookups
CREATE INDEX IF NOT EXISTS idx_telemarketing_task_list_items_contact_target
  ON telemarketing_task_list_items(contact_target_id);

CREATE INDEX IF NOT EXISTS idx_telemarketing_call_logs_contact_target
  ON telemarketing_call_logs(contact_target_id);

CREATE INDEX IF NOT EXISTS idx_telemarketing_appointments_contact_target
  ON telemarketing_appointments(contact_target_id);

-- 3. Fix lifecycle id column types in contact_targets
-- telemarketing_task_list_items.id is VARCHAR(100), so latest_task_list_item_id must match.
-- telemarketing_appointments.id is VARCHAR(100), so latest_appointment_id must match.
ALTER TABLE contact_targets
  ALTER COLUMN latest_task_list_item_id TYPE VARCHAR(100);

ALTER TABLE contact_targets
  ALTER COLUMN latest_appointment_id TYPE VARCHAR(100);