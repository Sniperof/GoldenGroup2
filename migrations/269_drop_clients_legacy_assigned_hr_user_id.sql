-- 2026-06-10
-- Drop legacy column clients.assigned_hr_user_id.
--
-- Per docs/constitution/domains/clients.md §500–502:
--   • Column was added in migration 031 as the original single-owner mechanism.
--   • Migration 042 replaced it with the M2M junction table `client_assignments`
--     to support multi-owner semantics (BR-4 in clients.md §115).
--   • The operational SELECT/ownership code has fully ignored this column
--     since 042 — confirmed by grep on staging (0 matches in clients.ts,
--     customerOwnership.ts, clientLifecycleService.ts).
--   • Live data check on staging (2026-06-10):
--       SELECT COUNT(*) FROM clients WHERE assigned_hr_user_id IS NOT NULL
--       → 0
--     client_assignments has 46 active rows.
--   • No views/triggers/functions depend on the column (pg_depend = 0).
--
-- The matching reference NOT touched by this migration:
--   `referral_sheets.assigned_hr_user_id` is a DIFFERENT column on a
--   DIFFERENT table, still live, with 9 active code paths in
--   packages/api/routes/referralSheets.ts.

BEGIN;

-- 1. Drop the FK constraint first (explicit, in case PG choke on the cascade).
ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS clients_assigned_hr_user_id_fkey;

-- 2. Drop the column.
ALTER TABLE clients
  DROP COLUMN IF EXISTS assigned_hr_user_id;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Reversal (DOWN) — run manually if a rollback is ever needed.
-- The column was always nullable with no default, so restoring it is safe.
-- ─────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- ALTER TABLE clients ADD COLUMN assigned_hr_user_id INTEGER;
-- ALTER TABLE clients
--   ADD CONSTRAINT clients_assigned_hr_user_id_fkey
--   FOREIGN KEY (assigned_hr_user_id) REFERENCES hr_users(id) ON DELETE SET NULL;
-- COMMIT;
