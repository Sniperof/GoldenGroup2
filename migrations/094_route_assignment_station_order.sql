ALTER TABLE route_assignments
  ADD COLUMN IF NOT EXISTS station_order JSONB DEFAULT '[]';
