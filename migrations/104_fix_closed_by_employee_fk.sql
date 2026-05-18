-- Migration 104: Fix closed_by_employee_id FKs to reference employees (not hr_users)
-- The application code consistently joins these columns with the employees table,
-- but two tables were mistakenly created with FKs pointing to hr_users, causing
-- FK violations when the frontend sends an employees.id that doesn't exist in hr_users.

ALTER TABLE open_task_pre_offers
  DROP CONSTRAINT IF EXISTS open_task_pre_offers_closed_by_employee_id_fkey;
ALTER TABLE open_task_pre_offers
  ADD CONSTRAINT open_task_pre_offers_closed_by_employee_id_fkey
  FOREIGN KEY (closed_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE marketing_visit_task_offers
  DROP CONSTRAINT IF EXISTS marketing_visit_task_offers_closed_by_employee_id_fkey;
ALTER TABLE marketing_visit_task_offers
  ADD CONSTRAINT marketing_visit_task_offers_closed_by_employee_id_fkey
  FOREIGN KEY (closed_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL;
