-- Add warranty_periods column to device_models
-- Structure: [{months: number, label: string, visits: number}]
-- visits = number of maintenance visits distributed over the warranty period
-- Computed interval = (months * 30) / visits days
ALTER TABLE device_models
  ADD COLUMN IF NOT EXISTS warranty_periods JSONB NOT NULL DEFAULT '[]';
