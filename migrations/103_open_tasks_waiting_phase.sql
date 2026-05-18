-- Migration 103: Waiting phase essentials for open_tasks
-- Adds structured waiting reason + attempt tracking
-- (last_waiting_status column already exists from migration 102; this migration starts populating it via app code)

-- Gap 1: Structured reason for being in waiting state (needs_reschedule)
ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS waiting_reason_id INTEGER REFERENCES system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS waiting_reason_text TEXT;

CREATE INDEX IF NOT EXISTS idx_open_tasks_waiting_reason
  ON open_tasks(waiting_reason_id) WHERE waiting_reason_id IS NOT NULL;

-- Gap 3: Attempt tracking (denormalized for performance)
ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_open_tasks_last_attempt
  ON open_tasks(last_attempt_at);

-- Backfill attempt_count from existing task_activity_log entries (call_made events)
UPDATE open_tasks ot
SET attempt_count = sub.cnt,
    last_attempt_at = sub.last_at
FROM (
  SELECT task_id, COUNT(*)::int AS cnt, MAX(created_at) AS last_at
  FROM task_activity_log
  WHERE event_type = 'call_made'
  GROUP BY task_id
) sub
WHERE ot.id = sub.task_id;
