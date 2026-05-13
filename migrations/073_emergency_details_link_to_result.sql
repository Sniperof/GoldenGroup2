-- Migration 073: Corrective — link emergency detail tables to visit_task_result, not visit_task.
-- Tables are empty (just created, no emergency results recorded yet) so zero data risk.
-- Before: detail tables used visit_task_id FK → visit_tasks(id)
-- After:  detail tables use visit_task_result_id FK → visit_task_results(id)
-- This aligns with the contract: specialized details are an extension of the general result,
-- not an extension of the task execution record.

-- ── visit_task_emergency_technical_states ─────────────────────────────────────
ALTER TABLE visit_task_emergency_technical_states
  DROP CONSTRAINT uq_vtets_task,
  DROP CONSTRAINT visit_task_emergency_technical_states_visit_task_id_fkey,
  DROP COLUMN visit_task_id;

ALTER TABLE visit_task_emergency_technical_states
  ADD COLUMN visit_task_result_id BIGINT NOT NULL
    REFERENCES visit_task_results(id) ON DELETE CASCADE,
  ADD CONSTRAINT uq_vtets_result UNIQUE (visit_task_result_id);

DROP INDEX IF EXISTS idx_vtets_task;
CREATE INDEX IF NOT EXISTS idx_vtets_result
  ON visit_task_emergency_technical_states(visit_task_result_id);

-- ── visit_task_emergency_parts_used ───────────────────────────────────────────
ALTER TABLE visit_task_emergency_parts_used
  DROP CONSTRAINT visit_task_emergency_parts_used_visit_task_id_fkey,
  DROP COLUMN visit_task_id;

ALTER TABLE visit_task_emergency_parts_used
  ADD COLUMN visit_task_result_id BIGINT NOT NULL
    REFERENCES visit_task_results(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_vtepu_task;
CREATE INDEX IF NOT EXISTS idx_vtepu_result
  ON visit_task_emergency_parts_used(visit_task_result_id);

-- ── visit_task_emergency_financials ───────────────────────────────────────────
ALTER TABLE visit_task_emergency_financials
  DROP CONSTRAINT uq_vtef_task,
  DROP CONSTRAINT visit_task_emergency_financials_visit_task_id_fkey,
  DROP COLUMN visit_task_id;

ALTER TABLE visit_task_emergency_financials
  ADD COLUMN visit_task_result_id BIGINT NOT NULL
    REFERENCES visit_task_results(id) ON DELETE CASCADE,
  ADD CONSTRAINT uq_vtef_result UNIQUE (visit_task_result_id);
