-- ============================================================================
-- 394_clients_records_performance_indexes.sql
-- ============================================================================
-- Phase 5 of the clients-records performance work
-- (docs/analysis/clients-records-performance-and-filters.md §3 step 5).
--
-- Targets the server-paginated clients list (GET /api/clients/paged) and its
-- derived statistics at 100k+ rows. Only genuinely-missing, high-impact indexes
-- are added here — the schema already covers clients(branch_id),
-- client_assignments(client_id/hr_user_id), installed_devices(customer_id),
-- open_tasks(client_id) & (task_type,status), and client_rating_history(client_id,changed_at).
--
-- NOTE: the migration runner wraps each file in a transaction, so
-- CREATE INDEX CONCURRENTLY cannot be used here. Regular CREATE INDEX briefly
-- locks the table for writes — acceptable for a one-off deploy step. Every
-- statement is IF NOT EXISTS, so re-running is safe.
-- ============================================================================

-- Trigram support for fast substring (ILIKE '%q%') search. Common extension;
-- requires privilege to CREATE EXTENSION on the target database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CRITICAL GAP: contracts.customer_id has a FK but no index. It is probed once
-- per client row by the lifecycle-stage and branch-visibility EXISTS subqueries
-- (buildClientLifecycleStatusSql / clientVisibleInBranchesCondition), so at 100k
-- clients this was a sequential scan per row. Single biggest win for the page.
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts (customer_id);

-- Free-text search on the records page matches name / referrer_name via ILIKE;
-- trigram GIN indexes turn those '%q%' scans into index lookups.
CREATE INDEX IF NOT EXISTS idx_clients_name_trgm
  ON clients USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clients_referrer_name_trgm
  ON clients USING gin (referrer_name gin_trgm_ops);

-- The device-serial filter matches installed_devices.serial_number via ILIKE.
CREATE INDEX IF NOT EXISTS idx_installed_devices_serial_trgm
  ON installed_devices USING gin (serial_number gin_trgm_ops);

-- Registration-date range filter (created_at >= .. < ..) and the createdAt sort.
CREATE INDEX IF NOT EXISTS idx_clients_created_at ON clients (created_at);

-- ----------------------------------------------------------------------------
-- Deliberately NOT indexed here (would need query/expression co-design, and are
-- optional filters that the branch scope already narrows):
--   * geo filters — compared as governorate::text = ANY(text[]); a plain btree
--     on the integer column is not used through the ::text cast. Revisit by
--     switching the predicate to int[] + btree, or expression indexes, if the
--     geo filter on "all branches" becomes a measured hotspot.
--   * phone search — matched through the phoneNormalizationSql() expression;
--     needs a stored normalized_mobile column or a matching expression index.
-- ----------------------------------------------------------------------------
