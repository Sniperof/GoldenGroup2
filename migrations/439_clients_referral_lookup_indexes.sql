-- ============================================================
-- 439_clients_referral_lookup_indexes.sql
-- ============================================================
-- Backs GET /api/clients/paged?referredByClientId=<id>, the scoped replacement
-- for ClientModal's old "load every client and filter in the browser" pass.
--
-- The predicate has two halves because a referrer is stored two ways: the legacy
-- flat columns, and the `referrers` JSONB array. One index each.
--
-- CREATE INDEX (not CONCURRENTLY) — the runner wraps migrations in a transaction.
-- On ~160k client rows this takes seconds and briefly locks writes.
-- ============================================================

-- Flat half: WHERE referral_entity_id = $1 AND referrer_type = 'Client'.
-- Partial, because only Client referrers are ever looked up this way.
CREATE INDEX IF NOT EXISTS idx_clients_referral_entity_client
  ON clients (referral_entity_id)
  WHERE referrer_type = 'Client';

-- JSONB half: c.referrers @> '[{"referralEntityId": N, "referrerType": "Client"}]'.
-- jsonb_path_ops is the smaller/faster operator class and supports @>.
CREATE INDEX IF NOT EXISTS idx_clients_referrers_gin
  ON clients USING gin (referrers jsonb_path_ops);

ANALYZE clients;
