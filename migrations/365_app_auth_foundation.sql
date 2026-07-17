-- ============================================================
-- 365_app_auth_foundation.sql
-- ============================================================
-- Phase 1 (DEC-013) — foundation tables for customer mobile-app
-- account creation + auth. Schema only; no code reads/writes yet
-- (mirrors 240_service_requests_table.sql "foundation" pattern).
--
-- Creates:
--   - app_accounts        : login identity linked to a clients record
--   - otp_verifications   : short-lived OTP challenge + pre-account handle
--   - app_refresh_tokens  : rotating refresh tokens (theft-detection family)
--
-- Does NOT touch service_requests constraints (completed state deferred to
-- Phase 3, wired with the state machine + per-type outcome lists).
--
-- FK targets verified in 001_initial_schema.sql: clients, hr_users.
-- Reference: docs/constitution/decisions/DEC-013-account-creation-and-app-auth.md
--            docs/constitution/features/account-creation-and-app-auth.md
-- ============================================================

BEGIN;

-- ── app_accounts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_accounts (
    id                        BIGSERIAL PRIMARY KEY,

    -- Login identity: normalized (normalizePhone) primary mobile.
    primary_mobile            VARCHAR(20) NOT NULL,

    status                    VARCHAR(20) NOT NULL DEFAULT 'active',

    -- Link target is ALWAYS a clients row (DEC-013 §9.1).
    linked_client_record_id   INTEGER NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,

    -- Automatic + immutable origin marker (DEC-013 §9.8).
    created_source            VARCHAR(40) NOT NULL,
    created_by_role           VARCHAR(20) NOT NULL DEFAULT 'system',
    created_by_user_id        INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,

    -- Suspend / reactivate (Audit Admin only).
    suspended_by_user_id      INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
    suspended_reason          TEXT,
    suspended_at              TIMESTAMPTZ,

    -- Soft-delete for Google Play account deletion (DEC-013 §9.6).
    deleted_at                TIMESTAMPTZ,
    deletion_source           VARCHAR(20),
    deletion_reason           TEXT,

    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT app_accounts_status_check
      CHECK (status IN ('active', 'suspended', 'deleted')),

    CONSTRAINT app_accounts_created_source_check
      CHECK (created_source IN (
        'account_creation', 'water_test_request', 'device_request',
        'maintenance_request', 'referral_request', 'golden_warranty_request',
        'admin', 'admin_bulk'
      )),

    CONSTRAINT app_accounts_created_by_role_check
      CHECK (created_by_role IN ('system', 'admin')),

    CONSTRAINT app_accounts_deletion_source_check
      CHECK (deletion_source IS NULL OR deletion_source IN ('app', 'web'))
);

-- Uniqueness policy: one ACTIVE account per normalized number (DEC-013 §9.2).
CREATE UNIQUE INDEX IF NOT EXISTS app_accounts_active_mobile_unique
  ON public.app_accounts (primary_mobile)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS app_accounts_client_idx
  ON public.app_accounts (linked_client_record_id);

CREATE INDEX IF NOT EXISTS app_accounts_mobile_idx
  ON public.app_accounts (primary_mobile);

CREATE OR REPLACE FUNCTION public.tg_app_accounts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_accounts_set_updated_at ON public.app_accounts;
CREATE TRIGGER app_accounts_set_updated_at
  BEFORE UPDATE ON public.app_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_app_accounts_set_updated_at();

COMMENT ON TABLE public.app_accounts IS
  'Customer mobile-app login identity, linked 1:1 to a clients record. See DEC-013.';
COMMENT ON COLUMN public.app_accounts.primary_mobile IS
  'Normalized (normalizePhone) login identifier. One ACTIVE account per number.';
COMMENT ON COLUMN public.app_accounts.created_source IS
  'Automatic + immutable. Differentiates customer-requested vs admin-created accounts (DEC-013 §9.8).';

-- ── otp_verifications ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.otp_verifications (
    id            BIGSERIAL PRIMARY KEY,

    -- Opaque one-time pre-account handle returned to the client.
    handle        UUID NOT NULL DEFAULT gen_random_uuid(),

    phone         VARCHAR(20) NOT NULL,          -- normalized
    purpose       VARCHAR(30) NOT NULL,

    code_hash     VARCHAR(255) NOT NULL,         -- hash of the OTP, never the code
    expires_at    TIMESTAMPTZ NOT NULL,          -- +120s per spec

    attempts      INTEGER NOT NULL DEFAULT 0,
    max_attempts  INTEGER NOT NULL DEFAULT 5,

    verified_at   TIMESTAMPTZ,                   -- set on successful verify
    consumed_at   TIMESTAMPTZ,                   -- set when the handle is used once

    last_sent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- resend window (60s)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT otp_verifications_purpose_check
      CHECK (purpose IN ('account_creation', 'login', 'account_deletion'))
);

CREATE UNIQUE INDEX IF NOT EXISTS otp_verifications_handle_unique
  ON public.otp_verifications (handle);

CREATE INDEX IF NOT EXISTS otp_verifications_phone_purpose_idx
  ON public.otp_verifications (phone, purpose, created_at DESC);

COMMENT ON TABLE public.otp_verifications IS
  'Short-lived OTP challenge. Stores the code HASH only. handle = opaque one-time pre-account proof (DEC-013 §6).';

-- ── app_refresh_tokens ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_refresh_tokens (
    id              BIGSERIAL PRIMARY KEY,
    app_account_id  BIGINT NOT NULL REFERENCES public.app_accounts(id) ON DELETE CASCADE,

    token_hash      VARCHAR(255) NOT NULL,       -- hash of the refresh token
    family_id       UUID NOT NULL DEFAULT gen_random_uuid(),

    issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,        -- +60 days per DEC-013 §6

    revoked_at      TIMESTAMPTZ,
    replaced_by_id  BIGINT REFERENCES public.app_refresh_tokens(id) ON DELETE SET NULL,

    device_label    VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_refresh_tokens_hash_unique
  ON public.app_refresh_tokens (token_hash);

CREATE INDEX IF NOT EXISTS app_refresh_tokens_active_account_idx
  ON public.app_refresh_tokens (app_account_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS app_refresh_tokens_family_idx
  ON public.app_refresh_tokens (family_id);

COMMENT ON TABLE public.app_refresh_tokens IS
  'Rotating refresh tokens (hash only). Reuse of a revoked row → revoke whole family_id (theft). See DEC-013 §6.';

COMMIT;
