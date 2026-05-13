ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS client_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS contract_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS team_snapshot JSONB;
