-- Migration 140: Add no_closing_reason_id to contracts referencing system_lists(id)
--

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS no_closing_reason_id INTEGER REFERENCES system_lists(id) ON DELETE SET NULL;
