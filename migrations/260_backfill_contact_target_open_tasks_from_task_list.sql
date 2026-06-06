-- Backfill the canonical contact-target/task bridge from generated call-list items.
-- Some historical rows have telemarketing_task_list_items.contact_target_id
-- without the matching contact_target_open_tasks row, which makes planning
-- dashboards fall back to the client grain instead of the contact-target grain.

INSERT INTO public.contact_target_open_tasks (
    contact_target_id,
    open_task_id,
    branch_id,
    team_key,
    date,
    link_status
)
SELECT
    tli.contact_target_id,
    tli.open_task_id,
    tl.branch_id,
    tl.team_key,
    tl.date::date,
    CASE
        WHEN ct.status = 'closed' THEN 'closed'
        WHEN tli.status IN ('booked', 'closed', 'completed') THEN 'closed'
        WHEN tli.status = 'excluded' THEN 'excluded'
        WHEN tli.status IN ('queued', 'in_call_list') THEN 'queued'
        ELSE 'ready'
    END
FROM public.telemarketing_task_list_items tli
JOIN public.telemarketing_task_lists tl
  ON tl.id = tli.task_list_id
JOIN public.contact_targets ct
  ON ct.id = tli.contact_target_id
JOIN public.open_tasks ot
  ON ot.id = tli.open_task_id
WHERE tli.contact_target_id IS NOT NULL
  AND tli.open_task_id IS NOT NULL
  AND tl.date ~ '^\d{4}-\d{2}-\d{2}$'
ON CONFLICT (contact_target_id, open_task_id, date)
DO UPDATE SET
    branch_id = EXCLUDED.branch_id,
    team_key = EXCLUDED.team_key,
    link_status = EXCLUDED.link_status,
    updated_at = NOW();

UPDATE public.open_tasks ot
   SET contact_target_id = tli.contact_target_id,
       updated_at = NOW()
  FROM public.telemarketing_task_list_items tli
 WHERE tli.open_task_id = ot.id
   AND tli.contact_target_id IS NOT NULL
   AND ot.contact_target_id IS DISTINCT FROM tli.contact_target_id;
