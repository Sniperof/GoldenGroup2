-- ============================================================
-- Migration 152: Drop marketing_visits legacy tables
-- Prerequisites (ALL must pass):
--   1. Code fully migrated (no references to marketing_visits)
--   2. Bridge data exists in field_visits / visit_tasks
--   3. Full DB backup taken
--   4. Server in maintenance mode or stopped
-- ============================================================

-- Step 1: Verify bridge data only if tables still exist (defensive check)
DO $$
DECLARE
  mv_count INT;
  fv_count INT;
  mvt_count INT;
  vt_count INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'marketing_visits'
  ) THEN
    RETURN; -- already dropped, nothing to verify
  END IF;

  SELECT COUNT(*) INTO mv_count FROM marketing_visits;
  SELECT COUNT(*) INTO fv_count FROM field_visits WHERE source_legacy_type = 'marketing_visit';
  SELECT COUNT(*) INTO mvt_count FROM marketing_visit_tasks;
  SELECT COUNT(*) INTO vt_count FROM visit_tasks WHERE source_legacy_type = 'marketing_visit_task';

  -- If there are marketing visits but no bridge, abort
  IF mv_count > 0 AND fv_count < mv_count THEN
    RAISE EXCEPTION 'ABORT: % marketing_visits found but only % bridge records in field_visits. Run bridge backfill first.', mv_count, fv_count;
  END IF;

  IF mvt_count > 0 AND vt_count < mvt_count THEN
    RAISE EXCEPTION 'ABORT: % marketing_visit_tasks found but only % bridge records in visit_tasks. Run bridge backfill first.', mvt_count, vt_count;
  END IF;
END $$;

-- Step 2: Drop child tables first
DROP TABLE IF EXISTS marketing_visit_task_offers CASCADE;

-- Step 3: Drop middle tables
DROP TABLE IF EXISTS marketing_visit_tasks CASCADE;

-- Step 4: Drop parent table
DROP TABLE IF EXISTS marketing_visits CASCADE;

-- Step 5: Drop legacy functions (if any exist)
DROP FUNCTION IF EXISTS sync_marketing_visit_to_field_visit() CASCADE;
DROP FUNCTION IF EXISTS apply_marketing_visit_result() CASCADE;
