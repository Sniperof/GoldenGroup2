BEGIN;

CREATE INDEX IF NOT EXISTS idx_job_vacancies_applicability
  ON public.job_vacancies (status, start_date, end_date);

WITH expired AS (
  UPDATE public.job_vacancies
     SET status = 'Closed',
         updated_at = NOW()
   WHERE status = 'Open'
     AND end_date < CURRENT_DATE
  RETURNING id
)
INSERT INTO public.audit_logs
  (entity_type, entity_id, action_type, performed_by_role,
   old_value, new_value, internal_reason)
SELECT 'job_vacancy', id, 'Vacancy Auto-Closed', 'system',
       'Open', 'Closed', 'end_date elapsed'
  FROM expired;

COMMIT;
