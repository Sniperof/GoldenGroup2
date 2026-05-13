ALTER TABLE job_vacancies
  ADD COLUMN IF NOT EXISTS has_car_required BOOLEAN DEFAULT FALSE;

UPDATE job_vacancies
SET has_car_required = COALESCE(has_car_required, FALSE)
WHERE has_car_required IS NULL;
