-- Make the structured branch reference the authorization source of truth for training courses.
UPDATE training_courses tc
   SET branch_id = jv.branch_id,
       branch = CASE
         WHEN NULLIF(BTRIM(tc.branch), '') IS NULL THEN jv.branch
         ELSE tc.branch
       END
  FROM job_vacancies jv
 WHERE tc.job_vacancy_id = jv.id
   AND tc.branch_id IS NULL
   AND jv.branch_id IS NOT NULL;

ALTER TABLE training_courses
  DROP CONSTRAINT IF EXISTS training_courses_branch_id_required;

-- NOT VALID preserves unmappable legacy rows while rejecting new branchless records.
ALTER TABLE training_courses
  ADD CONSTRAINT training_courses_branch_id_required
  CHECK (branch_id IS NOT NULL) NOT VALID;
