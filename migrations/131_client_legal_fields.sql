ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS mother_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS national_id_registry VARCHAR(255),
  ADD COLUMN IF NOT EXISTS national_id_issued_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS national_id_issue_date DATE,
  ADD COLUMN IF NOT EXISTS national_id_box VARCHAR(50);
