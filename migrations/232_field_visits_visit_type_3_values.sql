-- ============================================================
-- Migration 232: field_visits.visit_type — 3 values (DEC-003 D4)
-- ============================================================
-- Constitution source:
--   DEC-003 D4 — visit_type ∈ {marketing, service, mixed}. visit_family
--                is deprecated as a top-level classifier; per-task specifics
--                live on visit_tasks.task_type.
--
-- The legacy 'emergency' value collapses into 'service' because emergency
-- maintenance is a service-family activity. Visits with mixed-family tasks
-- become 'mixed' (computed later by the application layer; this migration
-- only widens the CHECK).
--
-- visit_family column is NOT dropped here — it stays as a legacy field
-- until Phase 9 (DEC-003 D4 note in domain file).
-- ============================================================

BEGIN;

-- Step 1: backfill legacy 'emergency' visit_type to 'service'
UPDATE field_visits
   SET visit_type = 'service',
       updated_at = NOW()
 WHERE visit_type = 'emergency';

-- Step 2: swap CHECK constraint
ALTER TABLE field_visits
  DROP CONSTRAINT IF EXISTS field_visits_visit_type_check;

ALTER TABLE field_visits
  ADD CONSTRAINT field_visits_visit_type_check
  CHECK (visit_type IN ('marketing', 'service', 'mixed'));

COMMIT;
