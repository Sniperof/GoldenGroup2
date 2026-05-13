-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 093: Backfill call-task links for telemarketing customer call logs
-- Ensures legacy telemarketing calls appear in the open-task call history.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO call_task_links (call_id, task_id)
SELECT ccl.id, tli.open_task_id
FROM customer_call_logs ccl
JOIN telemarketing_task_list_items tli
  ON tli.id = ccl.source_id
LEFT JOIN call_task_links ctl
  ON ctl.call_id = ccl.id
 AND ctl.task_id = tli.open_task_id
WHERE ccl.source_type = 'telemarketing_task'
  AND tli.open_task_id IS NOT NULL
  AND ctl.call_id IS NULL;
