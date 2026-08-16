BEGIN;

-- The recruitment referrer contract treats mobileNumber as optional.
-- Employee/Client referrers are linked by referral_entity_id, while
-- Personal/Unknown referrers may legitimately have no phone number.
ALTER TABLE public.referrers
  ALTER COLUMN mobile_number DROP NOT NULL;

COMMIT;
