-- ============================================================
-- 503_candidates_search_collapse_spaces.sql
-- ============================================================
-- The records-page search haystack (CANDIDATE_SEARCH_EXPR in
-- packages/api/routes/candidates.ts, indexed by migration 438) joins
-- first_name, nickname, last_name, mobile and referral_name_snapshot with
-- single spaces. With an empty nickname — 333k of the open names — the result
-- is "first␣␣last", so typing the full name "first last" never matched.
--
-- The expression now collapses every whitespace run to one space. regexp_replace
-- is IMMUTABLE, so it stays indexable. The index is rebuilt under the same name.
--
-- The expression MUST stay character-identical to CANDIDATE_SEARCH_EXPR —
-- otherwise the planner cannot use this index and search falls back to a
-- sequential scan over ~333k rows.
--
-- CREATE INDEX (not CONCURRENTLY) — the runner wraps each migration in a
-- transaction; takes a few seconds and briefly blocks writes on candidates.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS idx_candidates_search_trgm;

CREATE INDEX idx_candidates_search_trgm ON candidates USING gin (
  (regexp_replace(COALESCE(first_name, '') || ' ' || COALESCE(nickname, '') || ' ' || COALESCE(last_name, '') || ' ' || COALESCE(mobile, '') || ' ' || COALESCE(referral_name_snapshot, ''), '[[:space:]]+', ' ', 'g'))
  gin_trgm_ops
);

ANALYZE candidates;
