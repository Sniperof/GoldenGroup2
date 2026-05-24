ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS buyer_mother_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS buyer_national_id_registry VARCHAR(255),
  ADD COLUMN IF NOT EXISTS buyer_national_id_issued_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS buyer_national_id_issue_date DATE,
  ADD COLUMN IF NOT EXISTS buyer_national_id_box VARCHAR(50);
