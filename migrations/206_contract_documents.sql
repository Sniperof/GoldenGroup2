-- Migration 206: contract_documents per DEC-CT-14, DEC-CT-15
-- ----------------------------------------------------------------------
-- Reference: docs/constitution/contracts/08-resolved-decisions.md
--
-- Stores frozen legal copies of contracts:
--   - template_version  → which template was used (semver-like string)
--   - rendered_html     → the full HTML at the freeze moment
--   - content_hash      → SHA-256 of rendered_html (tamper detection)
--   - frozen_at         → instant of freezing (== draft→active transition)
--   - frozen_by         → who triggered the freeze (closer typically)
--   - is_amendment      → false for the first copy, true for subsequent versions
--
-- One contract can have multiple rows ordered by created_at. The newest row
-- with is_amendment=false is the original; later rows are amendments
-- (out of scope for the first release — see docs/06 §3).
-- ----------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS contract_documents (
  id                  SERIAL PRIMARY KEY,
  contract_id         INTEGER NOT NULL
                        REFERENCES contracts(id) ON DELETE CASCADE,
  template_version    VARCHAR(50) NOT NULL,
  rendered_html       TEXT        NOT NULL,
  content_hash        CHAR(64)    NOT NULL,
  is_amendment        BOOLEAN     NOT NULL DEFAULT FALSE,
  frozen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  frozen_by           INTEGER     REFERENCES employees(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_documents_contract
  ON contract_documents(contract_id);

-- Only one *original* (non-amendment) per contract.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_contract_documents_original_per_contract
  ON contract_documents(contract_id)
  WHERE is_amendment = FALSE;

COMMIT;
