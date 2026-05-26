-- Store the number of maintenance visits per warranty period on each contract
-- Computed maintenance interval = floor((warranty_months * 30) / warranty_visits) days
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS warranty_visits INT;
