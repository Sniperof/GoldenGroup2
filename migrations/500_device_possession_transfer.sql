-- 500: Administrative transfer of a device's possession to another client (2026-11-19)
--
-- The possession section could only append a ledger row: installed_devices.
-- customer_id, the collection tasks and the client ledger stayed on the old
-- holder. The transfer is now one operation (services/devicePossessionTransfer.ts).
-- Decisions (product owner, 2026-11-19):
--   D1  allowed only when every operational device task is completed or
--       cancelled, the device is delivered / installed / active / faulty /
--       out_of_service, and no active service agreement covers it.
--   D2  the reason comes from a managed list (device_possession_transfer_reasons);
--       «أخرى» needs a note.
--   D3  contract and golden warranties stay on the device, untouched.
--   D4  the remaining installments move to the new holder: the contract keeps
--       its buyer (the signed legal copy does not change) and gains a current
--       payer, contracts.payer_client_id (NULL = the buyer). The unpaid
--       remainder of the contract and of the golden warranties moves in the
--       client ledger (discount on the old holder, charge on the new one, at
--       each installment's due date); open collection tasks move with it.
--       Maintenance installments stay with the client who received the service.
--   D5  the location may change (this is also the path to correct migrated
--       data without touching the contract); the branch does not.
--   D6  today's date only; the possession ledger rows keep their history.
--   D7  permission: the existing installed_devices.possession.manage.

BEGIN;

-- ── 1) Current payer of a contract (D4) ─────────────────────────────────────
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS payer_client_id integer REFERENCES public.clients(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.contracts.payer_client_id IS
  'Who pays the remaining installments when not the buyer (possession transfer, migration 500). NULL = customer_id.';

-- ── 2) The transfer record ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_possession_transfers (
  id serial PRIMARY KEY,
  device_id integer NOT NULL REFERENCES public.installed_devices(id) ON DELETE CASCADE,
  from_client_id integer REFERENCES public.clients(id) ON DELETE SET NULL,
  to_client_id integer NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  possession_log_id integer REFERENCES public.device_possession_log(id) ON DELETE SET NULL,
  reason_code varchar(60) NOT NULL,
  notes text,
  contract_id integer REFERENCES public.contracts(id) ON DELETE SET NULL,
  contract_payer_from integer REFERENCES public.clients(id) ON DELETE SET NULL,
  contract_balance_syp numeric(14,2) NOT NULL DEFAULT 0,
  warranty_balance_syp numeric(14,2) NOT NULL DEFAULT 0,
  moved_task_ids integer[] NOT NULL DEFAULT '{}',
  location_changed boolean NOT NULL DEFAULT false,
  old_geo_unit_id integer REFERENCES public.geo_units(id) ON DELETE SET NULL,
  old_address_text text,
  new_geo_unit_id integer REFERENCES public.geo_units(id) ON DELETE SET NULL,
  new_address_text text,
  performed_by integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_possession_transfers_device
  ON public.device_possession_transfers (device_id, created_at DESC);

COMMENT ON TABLE public.device_possession_transfers IS
  'One row per administrative possession transfer of a device to another client (migration 500).';

-- The managed-list reason on the ledger row the transfer opens.
ALTER TABLE public.device_possession_log
  ADD COLUMN IF NOT EXISTS reason_code varchar(60);

-- ── 3) Reasons list (D2) ────────────────────────────────────────────────────
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_possession_transfer_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('migrated_data_correction', 10, '{"label":"تصحيح بيانات مهجّرة"}'),
  ('property_sold',            20, '{"label":"بيع العقار مع الجهاز"}'),
  ('device_sold',              30, '{"label":"بيع الجهاز لزبون آخر"}'),
  ('family_transfer',          40, '{"label":"انتقال داخل العائلة"}'),
  ('inheritance',              50, '{"label":"وراثة"}'),
  ('other',                    99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
   WHERE sl.category = 'device_possession_transfer_reasons' AND sl.value = v.value
);

COMMIT;
