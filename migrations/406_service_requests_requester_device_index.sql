-- DEC-016 D-WC3/D-WC4 — indexes for the requester-scoped intake caps.
--
-- With OTP gone the caps stop keying on a verified phone and key on the
-- device fingerprint (and its IP fallback) stored in `requester_external`.
-- Both caps run inside the intake transaction on every submission, so an
-- unindexed JSONB extraction would sequential-scan a growing table on the
-- hot path.
--
-- Also indexes the beneficiary phone: the open-request rule no longer reads
-- it, but duplicate detection now does on every insert (D-WC5).

BEGIN;

CREATE INDEX IF NOT EXISTS service_requests_requester_device_idx
  ON public.service_requests ((requester_external->>'device_id'), request_type, created_at DESC)
  WHERE requester_external->>'device_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_requests_requester_ip_idx
  ON public.service_requests ((requester_external->>'requester_ip'), request_type, created_at DESC)
  WHERE requester_external->>'requester_ip' IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_requests_beneficiary_phone_idx
  ON public.service_requests ((beneficiary_external->>'primary_phone'), request_type, created_at DESC)
  WHERE beneficiary_external->>'primary_phone' IS NOT NULL;

COMMIT;
