-- Store warranty_months directly on contracts (not computed from end date)
-- Together with warranty_visits, gives the maintenance interval:
--   interval_days = floor((warranty_months * 30) / warranty_visits)
-- Replaces maintenance_plan (legacy field kept for old contracts only)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS warranty_months INT;
