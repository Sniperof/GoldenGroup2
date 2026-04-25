-- Migration 031: conservative backfill for job_applications.branch_id
-- Repairs only rows whose branch can be derived safely from the linked vacancy.
-- Rows that remain NULL after this migration require manual review.

UPDATE job_applications a
   SET branch_id = v.branch_id
  FROM job_vacancies v
 WHERE a.job_vacancy_id = v.id
   AND a.branch_id IS NULL
   AND v.branch_id IS NOT NULL;
