-- ============================================================
-- Migration 220: Add cooldown + do_not_contact to clients
-- ============================================================
-- Constitution source:
--   DEC-005 D29 — cooldown على مستوى الزبون
--   plans/2026-05-31-execution-plan.md §DB-02, §DB-03
--
-- Behavior:
--   - cooldown_until: nullable date, after which the client is callable again.
--   - do_not_contact: permanent block flag (TRUE means never contact).
--   - Filter in syncAssignedTasks (Phase 3) uses: cooldown_until IS NULL
--     OR cooldown_until < CURRENT_DATE; do_not_contact = FALSE.
--   - Auto-activation on `not_interested` outcome happens in Phase 2 backend.
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS cooldown_until    DATE,
  ADD COLUMN IF NOT EXISTS cooldown_reason   TEXT,
  ADD COLUMN IF NOT EXISTS cooldown_set_by   INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cooldown_set_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS do_not_contact    BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_clients_cooldown_until ON clients(cooldown_until)
  WHERE cooldown_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_do_not_contact ON clients(do_not_contact)
  WHERE do_not_contact = TRUE;
