-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 065: Enhance Customer Call Logs
-- Adds answered_by, communication_channel, and status columns.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE customer_call_logs
  ADD COLUMN IF NOT EXISTS answered_by         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS communication_channel VARCHAR(50),
  ADD COLUMN IF NOT EXISTS status              VARCHAR(50) NOT NULL DEFAULT 'completed';

CREATE INDEX IF NOT EXISTS idx_customer_call_logs_contact_id
  ON customer_call_logs(customer_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_customer_call_logs_status
  ON customer_call_logs(status);
