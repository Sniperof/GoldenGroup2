-- 490: Indexes for the client lifecycle timeline (2026-11-02)
--
-- The timeline (GET /clients/:id/lifecycle) reads each milestone from its own
-- table by client. Three of those lookups had no index:
--   candidates.converted_to_lead_id — the suggested name a client came from;
--       a sequential scan of 333k names took ~190 ms on every timeline.
--   gift_records.customer_id, visit_task_device_transfer_results.from_client_id
--       — small today, indexed so the timeline stays flat as they grow.

CREATE INDEX IF NOT EXISTS idx_candidates_converted_to_lead
  ON public.candidates (converted_to_lead_id)
  WHERE converted_to_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gift_records_customer
  ON public.gift_records (customer_id);

CREATE INDEX IF NOT EXISTS idx_vt_device_transfer_results_from_client
  ON public.visit_task_device_transfer_results (from_client_id);
