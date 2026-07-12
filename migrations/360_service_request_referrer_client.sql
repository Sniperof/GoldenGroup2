-- ============================================================
-- 360_service_request_referrer_client.sql
-- ============================================================
-- When a request is submitted "for another person", the submitter is a mediator
-- (referrer). The mediator can be linked to (or created as) a real client record
-- using the same mechanism as the beneficiary. This column stores that link so
-- the beneficiary's client can point its referrer at a formal client entity
-- (referrer_type='Client' + referrer_id) instead of only a name snapshot.
-- ============================================================

BEGIN;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS referrer_client_id INTEGER
    REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS service_requests_referrer_client_idx
  ON public.service_requests (referrer_client_id)
  WHERE referrer_client_id IS NOT NULL;

COMMENT ON COLUMN public.service_requests.referrer_client_id IS
  'Client record linked to the mediator (referrer) of a for-another request. Set via the same link/create mechanism as beneficiary_client_id.';

COMMIT;
