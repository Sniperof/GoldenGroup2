-- Migration 102: Add Phase Zero fields to open_tasks
-- Context: Establishing the unified task model requires linking tasks to contracts
-- (not just clients) and adding the two-date system + lifecycle support fields.

-- Link to contract: identifies which device + installation address this task is about
ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS contract_id          INTEGER REFERENCES contracts(id) ON DELETE SET NULL;

-- Soft date: customer commitment ("come back next week") — passing it keeps task open
-- with a visual indicator only. Distinct from due_date (hard) and needs_follow_up (status).
ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS expected_date        DATE;

-- Stores the waiting status (open | needs_follow_up) before entering planning,
-- so the task returns to the correct state when planning fails or visit is cancelled.
ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS last_waiting_status  VARCHAR(20);

-- Reason captured when a task is cancelled — required for audit trail.
ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS cancellation_reason  TEXT;

CREATE INDEX IF NOT EXISTS idx_open_tasks_contract ON open_tasks(contract_id);
CREATE INDEX IF NOT EXISTS idx_open_tasks_expected_date ON open_tasks(expected_date);
