-- Migration 150: Back-fill visit_task_device_delivery/installation_results
-- from open_task_*_results for tasks that are already linked to a visit_task.
-- Safe to re-run (ON CONFLICT DO UPDATE). Does not delete open_task_* records.

BEGIN;

-- 1. Ensure visit_task_results exists for delivery open tasks linked to visit_tasks
INSERT INTO visit_task_results (
  visit_task_id, final_decision, reason_code, closing_notes,
  closed_by, closed_at, created_at, updated_at
)
SELECT
  vt.id,
  CASE r.outcome
    WHEN 'delivered_successfully' THEN 'delivered_successfully'
    ELSE 'not_completed'
  END,
  CASE WHEN r.outcome <> 'delivered_successfully' THEN r.outcome ELSE NULL END,
  r.notes,
  NULL,
  r.updated_at,
  r.created_at,
  r.updated_at
FROM open_task_delivery_results r
JOIN visit_tasks vt ON vt.source_open_task_id = r.open_task_id
ON CONFLICT (visit_task_id) DO UPDATE SET
  final_decision = EXCLUDED.final_decision,
  reason_code    = EXCLUDED.reason_code,
  closing_notes  = EXCLUDED.closing_notes,
  updated_at     = NOW();

-- 2. Back-fill visit_task_device_delivery_results
INSERT INTO visit_task_device_delivery_results (
  visit_task_result_id,
  outcome, serial_number, device_model_id,
  delivery_condition, delivery_address,
  delivery_lat, delivery_lng,
  actual_delivery_date, delivered_by_employee_id,
  customer_acknowledged, notes,
  created_at, updated_at
)
SELECT
  vtr.id,
  r.outcome, r.serial_number, NULL,
  r.delivery_condition, r.delivery_address,
  r.delivery_lat, r.delivery_lng,
  r.actual_delivery_date, r.delivered_by_employee_id,
  r.customer_acknowledged, r.notes,
  r.created_at, r.updated_at
FROM open_task_delivery_results r
JOIN visit_tasks vt ON vt.source_open_task_id = r.open_task_id
JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
ON CONFLICT (visit_task_result_id) DO UPDATE SET
  outcome                  = EXCLUDED.outcome,
  serial_number            = EXCLUDED.serial_number,
  delivery_condition       = EXCLUDED.delivery_condition,
  delivery_address         = EXCLUDED.delivery_address,
  actual_delivery_date     = EXCLUDED.actual_delivery_date,
  notes                    = EXCLUDED.notes,
  updated_at               = NOW();

-- 3. Ensure visit_task_results exists for installation open tasks linked to visit_tasks
INSERT INTO visit_task_results (
  visit_task_id, final_decision, reason_code, closing_notes,
  closed_by, closed_at, created_at, updated_at
)
SELECT
  vt.id,
  CASE r.outcome
    WHEN 'installed_successfully' THEN 'installed_successfully'
    ELSE 'not_completed'
  END,
  CASE WHEN r.outcome <> 'installed_successfully' THEN r.outcome ELSE NULL END,
  r.technical_notes,
  NULL,
  r.updated_at,
  r.created_at,
  r.updated_at
FROM open_task_installation_results r
JOIN visit_tasks vt ON vt.source_open_task_id = r.open_task_id
ON CONFLICT (visit_task_id) DO UPDATE SET
  final_decision = EXCLUDED.final_decision,
  reason_code    = EXCLUDED.reason_code,
  closing_notes  = EXCLUDED.closing_notes,
  updated_at     = NOW();

-- 4. Back-fill visit_task_device_installation_results
INSERT INTO visit_task_device_installation_results (
  visit_task_result_id,
  outcome, water_source_type, pipe_type, pipe_length_meters,
  electrical_connection, wall_mounting_done, installed_accessories,
  installation_start_date, installation_end_date,
  before_photos, after_photos, technical_notes, installed_by_employee_id,
  created_at, updated_at
)
SELECT
  vtr.id,
  r.outcome, r.water_source_type, r.pipe_type, r.pipe_length_meters,
  r.electrical_connection, r.wall_mounting_done, r.installed_accessories,
  r.installation_start_date, r.installation_end_date,
  r.before_photos, r.after_photos, r.technical_notes, r.installed_by_employee_id,
  r.created_at, r.updated_at
FROM open_task_installation_results r
JOIN visit_tasks vt ON vt.source_open_task_id = r.open_task_id
JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
ON CONFLICT (visit_task_result_id) DO UPDATE SET
  outcome               = EXCLUDED.outcome,
  technical_notes       = EXCLUDED.technical_notes,
  updated_at            = NOW();

COMMIT;
