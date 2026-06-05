-- Preserve physical device inputs while a sale contract is still a draft.
--
-- Phase 2C moved physical device fields out of contracts and into
-- installed_devices. Draft contracts intentionally do not materialize an
-- installed_devices row, so those inputs need a staging payload until approval.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS draft_device_payload jsonb;

COMMENT ON COLUMN public.contracts.draft_device_payload IS
  'Temporary staging payload for physical device fields entered while a sale_contract is draft. Applied to installed_devices on approval.';
