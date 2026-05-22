-- Migration 110: Marketing visits execution tracking
-- Adds visit number, GPS capture points, and timestamps for start/end transitions

ALTER TABLE marketing_visits
  ADD COLUMN IF NOT EXISTS visit_number   SERIAL,
  ADD COLUMN IF NOT EXISTS visit_start_gps    JSONB,        -- { lat, lng, accuracy } — captured at "بدء الزيارة"
  ADD COLUMN IF NOT EXISTS visit_started_at   TIMESTAMPTZ,  -- exact moment visit started
  ADD COLUMN IF NOT EXISTS visit_end_gps      JSONB,        -- { lat, lng, accuracy } — captured at "إنهاء الزيارة"
  ADD COLUMN IF NOT EXISTS visit_ended_at     TIMESTAMPTZ;  -- exact moment visit ended

-- Index for human-readable lookup by visit_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_visits_number
  ON marketing_visits(visit_number);
