-- Immutable, identity-based referral attribution.
-- Operational client.referrer_* fields remain a compatibility projection;
-- this table is the counting/audit source for new water-check referrals.

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_referral_attributions (
  id BIGSERIAL PRIMARY KEY,
  beneficiary_client_id BIGINT NOT NULL REFERENCES public.clients(id),
  referrer_type VARCHAR(30) NOT NULL,
  referrer_client_id BIGINT NULL REFERENCES public.clients(id),
  referrer_employee_id BIGINT NULL REFERENCES public.employees(id),
  referrer_name TEXT NOT NULL,
  source_type VARCHAR(40) NOT NULL,
  source_service_request_id BIGINT NULL REFERENCES public.service_requests(id),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NULL REFERENCES public.hr_users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT client_referral_attributions_type_check
    CHECK (referrer_type IN ('Client', 'Employee', 'Personal')),
  CONSTRAINT client_referral_attributions_source_check
    CHECK (source_type IN ('water_check')),
  CONSTRAINT client_referral_attributions_identity_check
    CHECK (
      (referrer_type = 'Client' AND referrer_client_id IS NOT NULL AND referrer_employee_id IS NULL)
      OR (referrer_type = 'Employee' AND referrer_employee_id IS NOT NULL AND referrer_client_id IS NULL)
      OR (referrer_type = 'Personal' AND referrer_client_id IS NULL AND referrer_employee_id IS NULL)
    ),
  CONSTRAINT client_referral_attributions_not_self_check
    CHECK (referrer_client_id IS NULL OR referrer_client_id <> beneficiary_client_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS client_referral_attributions_client_pair_uidx
  ON public.client_referral_attributions (beneficiary_client_id, referrer_client_id)
  WHERE referrer_type = 'Client';

CREATE UNIQUE INDEX IF NOT EXISTS client_referral_attributions_water_request_uidx
  ON public.client_referral_attributions (source_service_request_id)
  WHERE source_type = 'water_check';

CREATE UNIQUE INDEX IF NOT EXISTS client_referral_attributions_primary_uidx
  ON public.client_referral_attributions (beneficiary_client_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS client_referral_attributions_referrer_client_idx
  ON public.client_referral_attributions (referrer_client_id, attributed_at DESC)
  WHERE referrer_type = 'Client';

CREATE INDEX IF NOT EXISTS client_referral_attributions_beneficiary_idx
  ON public.client_referral_attributions (beneficiary_client_id, attributed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_client_referral_attributions_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'client_referral_attributions is append-only (% blocked)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS client_referral_attributions_no_update ON public.client_referral_attributions;
CREATE TRIGGER client_referral_attributions_no_update
  BEFORE UPDATE ON public.client_referral_attributions
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_referral_attributions_block_mutation();

DROP TRIGGER IF EXISTS client_referral_attributions_no_delete ON public.client_referral_attributions;
CREATE TRIGGER client_referral_attributions_no_delete
  BEFORE DELETE ON public.client_referral_attributions
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_referral_attributions_block_mutation();

COMMENT ON TABLE public.client_referral_attributions IS
  'Append-only referral attribution by stable identity and source; used for counting without rewriting client history.';

COMMIT;
