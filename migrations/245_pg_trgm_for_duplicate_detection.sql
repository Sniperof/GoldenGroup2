-- ============================================================
-- 245_pg_trgm_for_duplicate_detection.sql
-- ============================================================
-- Phase 0.7 — Enable pg_trgm extension + indexes for fuzzy
-- duplicate detection on service_requests.
--
-- Per maintenance.md §٠.١٥.أ:
--   - Algorithm: 0.50 × phone + 0.25 × device + 0.25 × problem.
--   - Threshold 0.75 within a 72h window.
--   - Implementation lives in Phase 2 services. This migration
--     only provides the DB-level infrastructure (extension + indexes).
--
-- Performance: gin_trgm_ops index keeps similarity() lookups
-- sub-linear even with hundreds of thousands of requests.
--
-- Reference: docs/constitution/features/tasks/maintenance.md §٠.١٥.أ
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on problem_description for fuzzy text similarity.
CREATE INDEX IF NOT EXISTS service_requests_problem_trgm_idx
  ON public.service_requests USING gin (problem_description gin_trgm_ops);

-- Phone-tail index (last 7 digits) — handles +963 vs 963 variants
-- transparently per ٠.١٥.أ phone-matching rules.
-- The phone lives inside requester_external JSONB → extract here.
CREATE INDEX IF NOT EXISTS service_requests_phone_tail_idx
  ON public.service_requests (
    (RIGHT(requester_external->>'primary_phone', 7))
  )
  WHERE requester_external ? 'primary_phone';

COMMENT ON EXTENSION pg_trgm IS
  'Trigram matching for duplicate detection on service_requests.problem_description (٠.١٥.أ).';

COMMIT;
