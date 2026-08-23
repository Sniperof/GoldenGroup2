BEGIN;

-- Non-sensitive SMS-provider tracking (Rasel integration). Never store the
-- OTP code itself here — code_hash already covers that on the existing row.
ALTER TABLE public.otp_verifications
  ADD COLUMN IF NOT EXISTS provider VARCHAR(20),
  ADD COLUMN IF NOT EXISTS provider_request_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS provider_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS provider_usage_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS send_failure_reason VARCHAR(50);

COMMIT;
