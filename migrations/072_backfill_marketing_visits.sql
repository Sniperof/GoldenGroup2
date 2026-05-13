-- Migration 072: Backfill existing marketing_visits data into the new core tables.
-- Idempotent: ON CONFLICT DO NOTHING / DO UPDATE, safe to run multiple times.
-- Does NOT modify any existing data in marketing_visits / marketing_visit_tasks.

-- ── Step 1: field_visits from marketing_visits ────────────────────────────────
INSERT INTO field_visits (
  visit_type, visit_family, status,
  client_id, branch_id,
  scheduled_date, scheduled_time,
  source_legacy_type, source_legacy_id,
  team_snapshot,
  closed_by, closed_at, created_by,
  created_at, updated_at
)
SELECT
  'marketing',
  'marketing',
  CASE mv.status
    WHEN 'scheduled'             THEN 'scheduled'
    WHEN 'completed'             THEN 'completed'
    WHEN 'not_completed'         THEN 'not_completed'
    WHEN 'postponed_by_company'  THEN 'postponed_by_company'
    WHEN 'postponed_by_customer' THEN 'postponed_by_customer'
    WHEN 'cancelled'             THEN 'cancelled'
    WHEN 'needs_reschedule'      THEN 'needs_reschedule'
    ELSE 'scheduled'
  END,
  mv.client_id,
  mv.branch_id,
  mv.scheduled_date::date,
  mv.scheduled_time,
  'marketing_visit',
  mv.id,
  mv.team_snapshot,
  mv.completed_by,
  mv.completed_at,
  mv.created_by,
  mv.created_at,
  mv.updated_at
FROM marketing_visits mv
ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET
  status     = EXCLUDED.status,
  closed_by  = EXCLUDED.closed_by,
  closed_at  = EXCLUDED.closed_at,
  updated_at = EXCLUDED.updated_at;


-- ── Step 2: visit_tasks from marketing_visit_tasks ────────────────────────────
INSERT INTO visit_tasks (
  field_visit_id, source_open_task_id,
  task_type, task_family, sequence_no,
  status, execution_notes,
  source_legacy_type, source_legacy_id,
  created_at, updated_at
)
SELECT
  fv.id,
  mvt.source_open_task_id,
  'device_demo',
  'marketing',
  1,
  CASE mvt.status
    WHEN 'completed'     THEN 'completed'
    WHEN 'not_completed' THEN 'not_completed'
    ELSE 'pending'
  END,
  mvt.result_notes,
  'marketing_visit_task',
  mvt.id,
  mvt.created_at,
  mvt.updated_at
FROM marketing_visit_tasks mvt
JOIN field_visits fv
  ON fv.source_legacy_type = 'marketing_visit'
  AND fv.source_legacy_id  = mvt.visit_id
ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET
  status          = EXCLUDED.status,
  execution_notes = EXCLUDED.execution_notes,
  updated_at      = EXCLUDED.updated_at;


-- ── Step 3: visit_task_results for tasks that have a recorded result ──────────
-- A result is considered recorded when result IS NOT NULL or status != 'pending'.
INSERT INTO visit_task_results (
  visit_task_id, final_decision, reason_code, closing_notes,
  closed_by, closed_at, created_at, updated_at
)
SELECT
  vt.id,
  COALESCE(mvt.result, 'not_completed'),
  CASE WHEN mvt.result IS NULL THEN mvt.status ELSE NULL END,
  mvt.result_notes,
  NULL,  -- closed_by not stored on marketing_visit_tasks
  COALESCE(mvt.completed_at, mvt.updated_at),
  mvt.created_at,
  mvt.updated_at
FROM marketing_visit_tasks mvt
JOIN visit_tasks vt
  ON vt.source_legacy_type = 'marketing_visit_task'
  AND vt.source_legacy_id  = mvt.id
WHERE mvt.status IN ('completed', 'not_completed')
ON CONFLICT (visit_task_id) DO UPDATE SET
  final_decision = EXCLUDED.final_decision,
  reason_code    = EXCLUDED.reason_code,
  closing_notes  = EXCLUDED.closing_notes,
  closed_at      = EXCLUDED.closed_at,
  updated_at     = EXCLUDED.updated_at;


-- ── Step 4: visit_task_device_demo_results for tasks with offer data ──────────
INSERT INTO visit_task_device_demo_results (
  visit_task_result_id,
  offer_type, offer_amount, installment_months,
  closed_by_employee_id, contract_id,
  created_at, updated_at
)
SELECT
  vtr.id,
  CASE
    WHEN mvt.result IN ('cash_offer_closed', 'cash_offer_not_closed')              THEN 'cash'
    WHEN mvt.result IN ('installment_offer_closed', 'installment_offer_not_closed') THEN 'installment'
    ELSE NULL
  END,
  CASE
    WHEN mvt.result IN ('cash_offer_closed', 'cash_offer_not_closed')              THEN mvt.cash_offer_amount
    WHEN mvt.result IN ('installment_offer_closed', 'installment_offer_not_closed') THEN mvt.installment_amount
    ELSE NULL
  END,
  CASE
    WHEN mvt.result IN ('installment_offer_closed', 'installment_offer_not_closed') THEN mvt.installment_months
    ELSE NULL
  END,
  mvt.closed_by_employee_id,
  mvt.contract_id,
  mvt.created_at,
  mvt.updated_at
FROM marketing_visit_tasks mvt
JOIN visit_tasks vt
  ON vt.source_legacy_type = 'marketing_visit_task'
  AND vt.source_legacy_id  = mvt.id
JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
WHERE mvt.result IN (
  'cash_offer_closed', 'cash_offer_not_closed',
  'installment_offer_closed', 'installment_offer_not_closed'
)
ON CONFLICT (visit_task_result_id) DO UPDATE SET
  offer_type            = EXCLUDED.offer_type,
  offer_amount          = EXCLUDED.offer_amount,
  installment_months    = EXCLUDED.installment_months,
  closed_by_employee_id = EXCLUDED.closed_by_employee_id,
  contract_id           = EXCLUDED.contract_id,
  updated_at            = EXCLUDED.updated_at;
