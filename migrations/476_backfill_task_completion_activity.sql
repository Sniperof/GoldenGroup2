-- 476: Backfill the missing completion row for tasks completed before 475
--
-- Completion through most visit result handlers never wrote a
-- task_activity_log row, so completedAt stays NULL and the "overdue" badge
-- never clears on those completed tasks. Reconstruct one `status_change` →
-- completed row per such task, dated by the latest closed visit result of the
-- task (fallback: the task's updated_at), attributed to that result's closer.
-- Rows are marked source/role/context = 'backfill' so they are never mistaken
-- for a live recording. old_value stays NULL: the true previous state is not
-- recoverable.

BEGIN;

INSERT INTO public.task_activity_log (
  task_id, event_type, performed_by, role, old_value, new_value,
  reference_id, source, context, created_at
)
SELECT ot.id,
       'status_change',
       last_result.closed_by,
       'backfill',
       NULL,
       'completed',
       last_result.result_id,
       'backfill',
       'backfill',
       COALESCE(last_result.closed_at, ot.updated_at, ot.created_at, now())
  FROM public.open_tasks ot
  LEFT JOIN LATERAL (
    SELECT vtr.id AS result_id, vtr.closed_by, vtr.closed_at
      FROM public.visit_tasks vt
      JOIN public.visit_task_results vtr ON vtr.visit_task_id = vt.id
     WHERE vt.source_open_task_id = ot.id
     ORDER BY vtr.closed_at DESC NULLS LAST, vtr.id DESC
     LIMIT 1
  ) last_result ON true
 WHERE ot.status = 'completed'
   AND NOT EXISTS (
     SELECT 1
       FROM public.task_activity_log tal
      WHERE tal.task_id = ot.id
        AND tal.event_type = 'status_change'
        AND tal.new_value = 'completed'
   );

COMMIT;
