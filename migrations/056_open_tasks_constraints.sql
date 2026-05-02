-- Add priority CHECK constraint to open_tasks
ALTER TABLE open_tasks ADD CONSTRAINT open_tasks_priority_check
  CHECK (priority IN ('high', 'medium', 'low') OR priority IS NULL);

-- Create trigger function for updated_at (used by open_tasks and future tables)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-set updated_at on every UPDATE to open_tasks
CREATE TRIGGER open_tasks_updated_at
  BEFORE UPDATE ON open_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
