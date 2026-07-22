-- Mobile service-request identity: visitor OTP or authenticated app customer.
-- Keeps app customers separate from requester_user_id (staff hr_users).

BEGIN;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS requester_app_account_id BIGINT
    REFERENCES public.app_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requester_client_id INTEGER
    REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS service_requests_requester_app_account_idx
  ON public.service_requests (requester_app_account_id)
  WHERE requester_app_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_requests_requester_client_idx
  ON public.service_requests (requester_client_id)
  WHERE requester_client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS app_accounts_live_mobile_unique
  ON public.app_accounts (primary_mobile)
  WHERE status IN ('active', 'suspended') AND deleted_at IS NULL;

ALTER TABLE public.otp_verifications
  DROP CONSTRAINT IF EXISTS otp_verifications_purpose_check;

ALTER TABLE public.otp_verifications
  ADD CONSTRAINT otp_verifications_purpose_check
  CHECK (purpose IN (
    'account_creation',
    'login',
    'account_deletion',
    'request_status',
    'service_request'
  ));

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_submitter_tier_check;

ALTER TABLE public.service_requests
  ADD CONSTRAINT service_requests_submitter_tier_check
  CHECK (submitter_tier IN ('visitor', 'customer', 'lead', 'fop', 'op', 'staff'));

COMMENT ON COLUMN public.service_requests.requester_app_account_id IS
  'Authenticated customer-app identity that submitted the request. Never points to staff users.';

COMMENT ON COLUMN public.service_requests.requester_client_id IS
  'Client record linked to the authenticated customer-app requester.';

COMMIT;
