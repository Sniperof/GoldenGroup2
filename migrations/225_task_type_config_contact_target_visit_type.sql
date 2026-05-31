-- ============================================================
-- Migration 225: Add contact_target_visit_type to task_type_config
-- ============================================================
-- Constitution source:
--   DEC-005 D24 — توحيد contact_targets لكل أنواع المهام
--   plans/2026-05-31-execution-plan.md §DB-25
--
-- Naming reconciliation:
--   DEC-005 D26 references `task_type_config.lead_window_days`. The existing
--   column is named `planning_window_days` (added in migration 106). They
--   express the SAME concept: "days before due/expected date when the task
--   appears in contact_targets". To avoid duplication (PR1 of execution plan),
--   we DO NOT add `lead_window_days`. Instead, code reads from
--   `planning_window_days`; constitution will be reconciled in Phase 10.
--
-- contact_target_visit_type seed mapping (per DEC-005 D24):
--   marketing tasks (device_demo, device_checkup)              → 'marketing'
--   delivery / service / maintenance / warranty / sales / emergency → 'service'
--   collection tasks (installment_collection, maintenance_collection) → 'collection'
-- ============================================================

ALTER TABLE task_type_config
  ADD COLUMN IF NOT EXISTS contact_target_visit_type VARCHAR(50);

-- ── Backfill from existing task_family ──────────────────────────────────
UPDATE task_type_config
   SET contact_target_visit_type = CASE
     WHEN task_family = 'marketing'  THEN 'marketing'
     WHEN task_family = 'collection' THEN 'collection'
     ELSE 'service'  -- delivery, service, maintenance, warranty, sales, emergency
   END
 WHERE contact_target_visit_type IS NULL;

-- ── CHECK constraint enforcing DEC-005 D24 vocabulary ────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'task_type_config_contact_target_visit_type_check'
      AND table_name      = 'task_type_config'
  ) THEN
    ALTER TABLE task_type_config
      ADD CONSTRAINT task_type_config_contact_target_visit_type_check
      CHECK (contact_target_visit_type IS NULL OR contact_target_visit_type IN (
        'marketing',
        'service',
        'collection'
      ));
  END IF;
END $$;

COMMENT ON COLUMN task_type_config.contact_target_visit_type IS
  'Category used when this task_type emits a contact_target (DEC-005 D24). When a single contact_target aggregates tasks of mixed categories, the application sets contact_targets.visit_type = "mixed" instead of using this value directly.';
COMMENT ON COLUMN task_type_config.planning_window_days IS
  'Alias of `lead_window_days` in DEC-005 D26. Days before due/expected date when the task appears in contact_targets. Constitution reconciliation pending Phase 10.';
