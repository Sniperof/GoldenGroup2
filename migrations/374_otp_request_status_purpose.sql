-- 374_otp_request_status_purpose.sql
-- ============================================================
-- DEC-013 — new OTP purpose `request_status`.
--
-- A visitor whose account request is still pending owns no token, so the
-- pending-request snapshot (name, phones, address) cannot be served by a
-- public phone-keyed route without turning it into a reverse directory.
-- Ownership of the number is proven the same way it is everywhere else in
-- this feature: an OTP handle. This purpose gates
-- POST /api/app/account-requests/mine, which returns the customer's own
-- submitted snapshot after the local copy is gone (app reinstall).
--
-- Rebuilds the full purpose list from 365 plus the new value.
-- ============================================================

BEGIN;

ALTER TABLE public.otp_verifications
  DROP CONSTRAINT IF EXISTS otp_verifications_purpose_check;

ALTER TABLE public.otp_verifications
  ADD CONSTRAINT otp_verifications_purpose_check
  CHECK (purpose IN (
    'account_creation',
    'login',
    'account_deletion',
    'request_status'
  ));

COMMIT;
