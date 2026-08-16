BEGIN;

-- DEF-017: an excluded task belongs only to the team retained on
-- open_tasks.assigned_team_key. Capture only currently provable mismatches;
-- historical rows whose task has since changed teams are left for audit.
CREATE TEMP TABLE def017_invalid_contact_target_links
ON COMMIT DROP
AS
SELECT
  ctot.id AS link_id,
  ctot.contact_target_id,
  ctot.open_task_id
FROM public.contact_target_open_tasks ctot
JOIN public.open_tasks ot
  ON ot.id = ctot.open_task_id
 AND ot.branch_id = ctot.branch_id
WHERE ctot.link_status = 'excluded'
  AND ctot.date = ot.excluded_for_date
  AND ot.assigned_team_key IS NOT NULL
  AND ctot.team_key <> ot.assigned_team_key;

-- The reconciliation bug could also point the task at the wrong team's
-- contact_target. Prefer its newest valid team-owned link, otherwise clear it.
UPDATE public.open_tasks ot
SET contact_target_id = (
      SELECT valid_link.contact_target_id
      FROM public.contact_target_open_tasks valid_link
      WHERE valid_link.open_task_id = ot.id
        AND valid_link.team_key = ot.assigned_team_key
        AND NOT EXISTS (
          SELECT 1
          FROM def017_invalid_contact_target_links invalid
          WHERE invalid.link_id = valid_link.id
        )
      ORDER BY
        CASE
          WHEN valid_link.date = COALESCE(ot.assigned_for_date, ot.excluded_for_date) THEN 0
          ELSE 1
        END,
        valid_link.updated_at DESC,
        valid_link.id DESC
      LIMIT 1
    ),
    updated_at = NOW()
WHERE EXISTS (
  SELECT 1
  FROM def017_invalid_contact_target_links invalid
  WHERE invalid.open_task_id = ot.id
    AND invalid.contact_target_id = ot.contact_target_id
);

DELETE FROM public.contact_target_open_tasks ctot
USING def017_invalid_contact_target_links invalid
WHERE ctot.id = invalid.link_id;

-- Remove only untouched targets created/closed by reconciliation and now left
-- without any legitimate dependency. Targets with calls, appointments, list
-- items, task links, or task pointers are preserved for manual audit.
DELETE FROM public.contact_targets ct
WHERE ct.id IN (
    SELECT DISTINCT invalid.contact_target_id
    FROM def017_invalid_contact_target_links invalid
  )
  AND ct.status = 'closed'
  AND ct.closing_reason = 'manual_supervisor'
  AND NOT EXISTS (
    SELECT 1
    FROM public.contact_target_open_tasks remaining_link
    WHERE remaining_link.contact_target_id = ct.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.telemarketing_task_list_items item
    WHERE item.contact_target_id = ct.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.telemarketing_call_logs call_log
    WHERE call_log.contact_target_id = ct.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.telemarketing_appointments appointment
    WHERE appointment.contact_target_id = ct.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.open_tasks task
    WHERE task.contact_target_id = ct.id
  );

COMMIT;
