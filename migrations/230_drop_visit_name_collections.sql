-- ============================================================
-- Migration 230: Drop visit_name_collections (DEC-007 D40)
-- ============================================================
-- Constitution source:
--   DEC-007 D40 — visit_name_collections is replaced by referral_sheets bound
--                 directly to field_visit_id (UNIQUE — migration 216).
--   DEC-007 D45 — referral list becomes optional; the legacy completion guard
--                 on proposed_count/actual_count is dropped.
--
-- Bridge behavior:
--   migration 082 created visit_name_collections with proposed_count +
--   actual_count + referral_sheet_id. Field teams entered proposed_count
--   into the row, and referral_sheets.target_candidates was added in
--   migration 111. The bridge here:
--     1. Backfills referral_sheets.target_candidates from visit_name_collections.proposed_count
--        for any visit that has a vnc row but no referral_sheet yet linked.
--     2. Sets referral_sheets.field_visit_id from vnc->visit_tasks->field_visits chain
--        when not already populated.
--     3. Refuses to drop the table if any vnc row has actual_count > 0 (means
--        real names were collected and would be lost). Operator must reconcile
--        first.
--
-- After Phase 6 backend goes live, no code reads or writes visit_name_collections.
-- This migration enforces both: data preservation + final drop.
-- ============================================================

BEGIN;

-- ── Step 1: bridge backfill into referral_sheets ──────────────────────────
-- Only act on rows where the vnc has a referral_sheet AND that sheet is not
-- yet bound to the right field_visit_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'visit_name_collections'
  ) THEN
    UPDATE referral_sheets rs
       SET field_visit_id    = COALESCE(rs.field_visit_id, fv_lookup.field_visit_id),
           target_candidates = GREATEST(rs.target_candidates, fv_lookup.proposed_count)
      FROM (
        SELECT vnc.referral_sheet_id, vt.field_visit_id, vnc.proposed_count
          FROM visit_name_collections vnc
          JOIN visit_tasks vt ON vt.id = vnc.visit_task_id
         WHERE vnc.referral_sheet_id IS NOT NULL
      ) fv_lookup
     WHERE rs.id = fv_lookup.referral_sheet_id;
  END IF;
END $$;

-- ── Step 2: refuse if any vnc has actual_count > 0 (would lose data) ──────
DO $$
DECLARE
  unsafe_count INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'visit_name_collections'
  ) THEN
    SELECT COUNT(*) INTO unsafe_count
      FROM visit_name_collections
     WHERE actual_count > 0;
    IF unsafe_count > 0 THEN
      RAISE EXCEPTION 'ABORT: % visit_name_collections rows have actual_count > 0. Manual reconciliation required before DROP (DEC-007 D40).', unsafe_count;
    END IF;
  END IF;
END $$;

-- ── Step 3: drop the table ────────────────────────────────────────────────
DROP TABLE IF EXISTS visit_name_collections CASCADE;

COMMIT;
