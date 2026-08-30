-- ============================================================
-- 438_candidates_records_performance_indexes.sql
-- ============================================================
-- Indexes for the server-paginated candidate records surface
-- (GET /api/candidates/paged — docs/analysis/candidates-records-performance-and-filters.md §6).
--
-- Sibling of migration 394, which did the same for the clients records page.
-- Every index below backs a predicate the paged route actually emits: the scope
-- conditions, the default sort, the filters, and the two batch lookups the
-- sheet-details modal / client modal / telemarketer board use.
--
-- CREATE INDEX (not CONCURRENTLY) — the runner wraps each migration in a
-- transaction. On the ~333k-row candidates table each index takes a few seconds
-- and briefly locks writes, so apply outside data-entry hours.
-- ============================================================

-- Default sort of the records page: created_at DESC, id DESC.
CREATE INDEX IF NOT EXISTS idx_candidates_created_at ON candidates (created_at DESC, id DESC);

-- Scope: every request filters by branch (explicit header, BRANCH or ASSIGNED).
CREATE INDEX IF NOT EXISTS idx_candidates_branch ON candidates (branch_id);

-- Status: the KPI GROUP BY and the status filter.
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates (status);

-- Sheet-details modal: this sheet's names only.
CREATE INDEX IF NOT EXISTS idx_candidates_referral_sheet ON candidates (referral_sheet_id);

-- Client modal: the names a given client referred.
CREATE INDEX IF NOT EXISTS idx_candidates_referral_entity ON candidates (referral_entity_id);

-- "created by" filter.
CREATE INDEX IF NOT EXISTS idx_candidates_created_by ON candidates (created_by);

-- ASSIGNED scope (EXISTS ... WHERE hr_user_id = $n) and the responsible-user
-- filter. Leading column is the user because that is what both predicates fix.
CREATE INDEX IF NOT EXISTS idx_candidate_assignments_user
  ON candidate_assignments (hr_user_id, candidate_id);

-- Search. The expression MUST stay character-identical to CANDIDATE_SEARCH_EXPR
-- in packages/api/routes/candidates.ts — otherwise the planner cannot use this
-- index and search silently falls back to a sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_candidates_search_trgm ON candidates USING gin (
  (COALESCE(first_name, '') || ' ' || COALESCE(nickname, '') || ' ' || COALESCE(last_name, '') || ' ' || COALESCE(mobile, '') || ' ' || COALESCE(referral_name_snapshot, ''))
  gin_trgm_ops
);

-- Fresh statistics so the planner actually picks the new indexes.
ANALYZE candidates;
ANALYZE candidate_assignments;
