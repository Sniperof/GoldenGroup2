-- ============================================================
-- 426_app_notifications.sql — Customer-app notification inbox + push tokens
-- ============================================================
-- DEC-019. Two tables:
--   app_notifications               : the inbox (source of truth, per DEC-019 §1)
--   app_notification_registrations  : FCM device tokens per (account, device)
--
-- The mobile app is the existing consumer of this contract, so the response
-- shape is fixed (snake_case, `id` as a STRING, DRF envelope). None of that is
-- visible here: this migration only has to make those shapes cheap to build.
--
-- Recipient is the app_account, NOT the client (DEC-019 D-N12). One client may
-- own several active accounts (different phones) and an event fans out to all
-- of them; that is a producer-side loop, not a schema concern.
--
-- Phase 1 of 7 — schema only, no code reads these yet (mirrors the 365
-- "foundation" pattern).
-- ============================================================

BEGIN;

-- ── app_notifications ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_notifications (
    id               BIGSERIAL   PRIMARY KEY,

    app_account_id   BIGINT      NOT NULL
                                 REFERENCES public.app_accounts(id) ON DELETE CASCADE,

    -- Wire type value (DEC-019 D-N1). Deliberately NOT an enum/CHECK list:
    -- notification types are added in code, same convention as
    -- visit_tasks.task_type (DEC-017 D-AV8).
    type             VARCHAR(60) NOT NULL,

    -- Push title. The inbox card renders `message` only; `title` exists for the
    -- FCM notification block, which needs a separate short line.
    title            VARCHAR(150),

    -- Stored ready, not a template key (DEC-019 D-N13). Language is frozen at
    -- creation time from the newest registration's locale.
    message          TEXT        NOT NULL,
    locale           VARCHAR(5)  NOT NULL DEFAULT 'ar',

    -- The payload map returned verbatim to the app AND mirrored into the FCM
    -- data block. Holds `type` + `destination`/`destination_id` (DEC-019 §1).
    data             JSONB       NOT NULL DEFAULT '{}'::jsonb,

    -- Dedup coordinates for the time-based family (DEC-019 D-N4). Both NULL for
    -- reactive notifications, which are allowed to repeat.
    entity_id        BIGINT,
    window_key       VARCHAR(40),

    is_read          BOOLEAN     NOT NULL DEFAULT FALSE,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at          TIMESTAMPTZ,
    read_at          TIMESTAMPTZ,

    -- Set only for admin free-form sends (DEC-019 D-N6); NULL for system events.
    created_by       INTEGER     REFERENCES public.hr_users(id) ON DELETE SET NULL
);

-- The `type` column and `data->>'type'` are two copies of one fact: the column
-- is what we index and toggle on, the JSON key is what the app parses. Drift
-- between them means the card renders the wrong icon while our queries think
-- otherwise, so the DB refuses the write instead.
ALTER TABLE public.app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_type_mirror_ck,
  ADD  CONSTRAINT app_notifications_type_mirror_ck
    CHECK (data->>'type' = type);

ALTER TABLE public.app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_message_ck,
  ADD  CONSTRAINT app_notifications_message_ck
    CHECK (length(btrim(message)) > 0);

-- read_at and is_read must agree; a read row with no timestamp (or the reverse)
-- silently corrupts any future "unread since" reporting.
ALTER TABLE public.app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_read_state_ck,
  ADD  CONSTRAINT app_notifications_read_state_ck
    CHECK ((is_read AND read_at IS NOT NULL) OR (NOT is_read AND read_at IS NULL));

-- The inbox query: WHERE app_account_id = ? ORDER BY created_at DESC, id DESC.
-- `id DESC` is not decoration. NOW() is the TRANSACTION timestamp in Postgres,
-- so a fan-out that inserts several rows at once gives them an IDENTICAL
-- created_at. Ordering on created_at alone would then be non-deterministic
-- between the page-1 and page-2 queries, and OFFSET pagination would drop or
-- repeat rows across pages.
CREATE INDEX IF NOT EXISTS app_notifications_inbox_idx
  ON public.app_notifications (app_account_id, created_at DESC, id DESC);

-- Backs the optional unread-count endpoint (§F.5) without scanning the inbox.
CREATE INDEX IF NOT EXISTS app_notifications_unread_idx
  ON public.app_notifications (app_account_id)
  WHERE NOT is_read;

-- Dedup for the daily sweep (DEC-019 D-N4): re-running it must not re-notify.
-- Partial, so reactive rows (window_key IS NULL) stay unconstrained — the same
-- service request may legitimately change status twice.
CREATE UNIQUE INDEX IF NOT EXISTS app_notifications_window_unique
  ON public.app_notifications (app_account_id, type, entity_id, window_key)
  WHERE window_key IS NOT NULL;

-- ── app_notification_registrations ──────────────────────────
CREATE TABLE IF NOT EXISTS public.app_notification_registrations (
    id               BIGSERIAL   PRIMARY KEY,

    app_account_id   BIGINT      NOT NULL
                                 REFERENCES public.app_accounts(id) ON DELETE CASCADE,

    -- Opaque handset id from the app (§I.3): Android "${brand}_${model}_${id}))"
    -- — trailing "))" included — or iOS identifierForVendor, or a stored UUID.
    -- Never parsed, only compared.
    device_id        VARCHAR(200) NOT NULL,

    platform         VARCHAR(10)  NOT NULL,
    fcm_token        TEXT         NOT NULL,
    locale           VARCHAR(5),

    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_notification_registrations
  DROP CONSTRAINT IF EXISTS app_notification_registrations_platform_ck,
  ADD  CONSTRAINT app_notification_registrations_platform_ck
    CHECK (platform IN ('ios', 'android'));

-- The app re-POSTs register-token whenever token/user/locale changes, so the
-- endpoint upserts on this key rather than failing on duplicates (§F.2).
CREATE UNIQUE INDEX IF NOT EXISTS app_notification_registrations_account_device_unique
  ON public.app_notification_registrations (app_account_id, device_id);

-- One handset, two accounts (someone signs out and a family member signs in):
-- the stale row would still receive pushes meant for the previous account, on a
-- device that person no longer controls. The write path clears other accounts'
-- rows for the same token; this index makes that lookup cheap.
CREATE INDEX IF NOT EXISTS app_notification_registrations_token_idx
  ON public.app_notification_registrations (fcm_token);

COMMIT;
