-- DEC-016 D-WC2 — a third submitter tier: `unverified`.
--
-- OTP disappears from the water_check mobile path, so a submission can arrive
-- with no proof of phone ownership at all. It is NOT stored as `visitor`:
-- that value means "phone was proven by OTP" in every row written so far, and
-- widening it would make an unproven row indistinguishable from a proven one
-- for the reviewer. A new value keeps the old rows' meaning intact.

BEGIN;

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_submitter_tier_check;

ALTER TABLE public.service_requests
  ADD CONSTRAINT service_requests_submitter_tier_check
  CHECK (submitter_tier IN (
    'visitor',
    'unverified',
    'customer',
    'lead',
    'fop',
    'op',
    'staff'
  ));

COMMENT ON COLUMN public.service_requests.submitter_tier IS
  'Trust level of the submitter. `customer` = derived from a client record; '
  '`visitor` = phone proven by OTP; `unverified` = self-declared, identified '
  'only by a client-controlled device fingerprint (DEC-016 D-WC2/D-WC3).';

COMMIT;
