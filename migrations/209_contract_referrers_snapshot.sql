-- 209_contract_referrers_snapshot.sql
--
-- Store the selected customer referrers on the contract itself as a frozen
-- JSON snapshot. This supports printable contracts and contract detail views
-- without depending on future edits to the customer master record.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS contract_referrers JSONB NOT NULL DEFAULT '[]'::jsonb;

