-- Migration 147: Extend visit_tasks for Phase-2 visit unification
-- Adds legacy_result snapshot column to visit_tasks.
-- task_type/task_family constraints and source_legacy_* columns already
-- exist from migration 070 and later patches.

BEGIN;

ALTER TABLE visit_tasks
  ADD COLUMN IF NOT EXISTS legacy_result VARCHAR(50);

COMMIT;
