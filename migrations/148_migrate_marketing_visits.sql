-- Migration 148: Back-fill visit_tasks / visit_task_results / visit_task_device_demo_results
-- for marketing_visit_tasks that were not yet synced by the bridge.
-- Safe to re-run (uses ON CONFLICT).
-- Also safe to run when marketing_visit_tasks no longer exists (e.g. already dropped manually).

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'marketing_visit_tasks'
  ) THEN

    -- 1. Upsert visit_tasks for unsynced marketing_visit_tasks
    INSERT INTO visit_tasks (
      field_visit_id, source_open_task_id,
      task_type, task_family, sequence_no,
      status, execution_notes, legacy_result,
      source_legacy_type, source_legacy_id,
      created_at, updated_at
    )
    SELECT
      fv.id,
      NULL,
      'device_demo', 'marketing', 1,
      CASE
        WHEN mvt.status = 'completed'     THEN 'completed'
        WHEN mvt.status = 'not_completed' THEN 'not_completed'
        ELSE 'pending'
      END,
      mvt.result_notes,
      mvt.result,
      'marketing_visit_task',
      mvt.id,
      mvt.created_at,
      mvt.updated_at
    FROM marketing_visit_tasks mvt
    JOIN marketing_visits mv ON mv.id = mvt.visit_id
    JOIN field_visits fv
      ON fv.source_legacy_type = 'marketing_visit'
     AND fv.source_legacy_id   = mv.id::varchar
    ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET
      status          = EXCLUDED.status,
      execution_notes = EXCLUDED.execution_notes,
      legacy_result   = EXCLUDED.legacy_result,
      updated_at      = NOW();

    -- 2. Upsert visit_task_results for all synced marketing_visit_tasks
    INSERT INTO visit_task_results (
      visit_task_id,
      final_decision, reason_code, closing_notes,
      closed_by, closed_at, created_at, updated_at
    )
    SELECT
      vt.id,
      CASE mvt.result
        WHEN 'cash_offer_closed'          THEN 'offer_accepted_cash'
        WHEN 'installment_offer_closed'   THEN 'offer_accepted_installment'
        WHEN 'cash_offer_not_closed'      THEN 'offer_declined'
        WHEN 'installment_offer_not_closed' THEN 'offer_declined'
        WHEN 'demo_not_completed'         THEN 'not_completed'
        ELSE                                   'not_completed'
      END,
      CASE WHEN mv.status <> 'completed' THEN mv.status ELSE NULL END,
      mvt.result_notes,
      NULL,
      mvt.completed_at,
      mvt.created_at,
      mvt.updated_at
    FROM marketing_visit_tasks mvt
    JOIN marketing_visits mv ON mv.id = mvt.visit_id
    JOIN visit_tasks vt
      ON vt.source_legacy_type = 'marketing_visit_task'
     AND vt.source_legacy_id   = mvt.id
    WHERE mvt.result IS NOT NULL
    ON CONFLICT (visit_task_id) DO UPDATE SET
      final_decision = EXCLUDED.final_decision,
      reason_code    = EXCLUDED.reason_code,
      closing_notes  = EXCLUDED.closing_notes,
      closed_at      = COALESCE(EXCLUDED.closed_at, visit_task_results.closed_at),
      updated_at     = NOW();

    -- 3. Upsert visit_task_device_demo_results for tasks with offer results
    INSERT INTO visit_task_device_demo_results (
      visit_task_result_id,
      offer_type, offer_amount, installment_months,
      closed_by_employee_id,
      created_at, updated_at
    )
    SELECT
      vtr.id,
      CASE WHEN mvt.result IN ('cash_offer_closed','cash_offer_not_closed') THEN 'cash'
           ELSE 'installment' END,
      mvt.cash_offer_amount,
      mvt.installment_months,
      mvt.closed_by_employee_id,
      mvt.created_at,
      mvt.updated_at
    FROM marketing_visit_tasks mvt
    JOIN visit_tasks vt
      ON vt.source_legacy_type = 'marketing_visit_task'
     AND vt.source_legacy_id   = mvt.id
    JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
    WHERE mvt.result IN (
      'cash_offer_closed', 'installment_offer_closed',
      'cash_offer_not_closed', 'installment_offer_not_closed'
    )
    ON CONFLICT (visit_task_result_id) DO UPDATE SET
      offer_type            = EXCLUDED.offer_type,
      offer_amount          = EXCLUDED.offer_amount,
      installment_months    = EXCLUDED.installment_months,
      closed_by_employee_id = EXCLUDED.closed_by_employee_id,
      updated_at            = NOW();

  END IF;
END $$;

COMMIT;
