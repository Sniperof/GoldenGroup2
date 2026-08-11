BEGIN;

-- Reconcile upcoming periodic-maintenance tasks left behind by successful
-- historical ownership transfers. Completed/closed/cancelled work and tasks
-- already in execution are intentionally preserved.
CREATE TEMP TABLE transfer_periodic_tasks_to_cancel ON COMMIT DROP AS
SELECT periodic.id AS task_id,
       periodic.status AS old_status,
       (
         SELECT transfer_result.closed_by
           FROM visit_task_device_transfer_results transfer_detail
           JOIN visit_task_results transfer_result
             ON transfer_result.id = transfer_detail.visit_task_result_id
           JOIN visit_tasks transfer_visit_task
             ON transfer_visit_task.id = transfer_result.visit_task_id
           JOIN open_tasks transfer_task
             ON transfer_task.id = transfer_visit_task.source_open_task_id
          WHERE transfer_task.device_id = periodic.device_id
            AND transfer_detail.final_decision = 'transferred_successfully'
            AND transfer_detail.transfer_kind = 'another_customer'
            AND transfer_detail.ownership_transferred = TRUE
            AND transfer_detail.from_client_id = periodic.client_id
          ORDER BY transfer_result.closed_at DESC NULLS LAST, transfer_result.id DESC
          LIMIT 1
       ) AS performed_by
  FROM open_tasks periodic
  JOIN installed_devices device ON device.id = periodic.device_id
 WHERE periodic.task_type = 'periodic_maintenance'
   AND periodic.status IN (
     'open',
     'needs_follow_up',
     'assigned',
     'in_scheduling',
     'scheduled',
     'waiting_execution'
   )
   AND device.customer_id <> periodic.client_id
   AND EXISTS (
     SELECT 1
       FROM visit_task_device_transfer_results transfer_detail
       JOIN visit_task_results transfer_result
         ON transfer_result.id = transfer_detail.visit_task_result_id
       JOIN visit_tasks transfer_visit_task
         ON transfer_visit_task.id = transfer_result.visit_task_id
       JOIN open_tasks transfer_task
         ON transfer_task.id = transfer_visit_task.source_open_task_id
      WHERE transfer_task.device_id = periodic.device_id
        AND transfer_detail.final_decision = 'transferred_successfully'
        AND transfer_detail.transfer_kind = 'another_customer'
        AND transfer_detail.ownership_transferred = TRUE
        AND transfer_detail.from_client_id = periodic.client_id
   );

UPDATE open_tasks periodic
   SET status = 'cancelled',
       cancellation_reason = 'نقل حيازة الجهاز إلى زبون آخر',
       updated_at = NOW()
  FROM transfer_periodic_tasks_to_cancel target
 WHERE periodic.id = target.task_id;

UPDATE visit_tasks visit_task
   SET status = 'cancelled',
       updated_at = NOW()
  FROM transfer_periodic_tasks_to_cancel target
 WHERE visit_task.source_open_task_id = target.task_id
   AND visit_task.status NOT IN ('completed', 'cancelled');

INSERT INTO task_activity_log (
  task_id,
  event_type,
  performed_by,
  role,
  old_value,
  new_value,
  reason
)
SELECT target.task_id,
       'status_change',
       target.performed_by,
       'system',
       target.old_status,
       'cancelled',
       'device_possession_transferred_historical_reconciliation'
  FROM transfer_periodic_tasks_to_cancel target;

COMMIT;
