-- ============================================================
-- 429_app_notification_broadcasts.sql — Admin free-form send (DEC-019 D-N6/D-N7)
-- ============================================================
-- One row per admin send. This table IS the third mandatory safety guard from
-- D-N6 ("a record of who sent what, to whom, and when"): a broadcast reaches
-- thousands of handsets and cannot be recalled, so the only way to answer
-- "why did my customer get this?" afterwards is to have written it down first.
--
-- `audience` stores the exact filter that was used, not a prose summary, so a
-- send can be explained — and re-counted — long after the underlying client
-- rows have moved between branches or geo units.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_notification_broadcasts (
    id                 BIGSERIAL   PRIMARY KEY,

    title              VARCHAR(150) NOT NULL,
    message            TEXT         NOT NULL,
    locale             VARCHAR(5)   NOT NULL DEFAULT 'ar',

    -- Optional tap target. A broadcast may legitimately point nowhere, in which
    -- case the app opens the notifications list.
    destination        VARCHAR(30),
    destination_id     VARCHAR(40),

    -- The filter as submitted: { branchId, geoIds, clientId }.
    audience           JSONB        NOT NULL DEFAULT '{}'::jsonb,

    -- What the operator was shown in the preview vs what was actually written.
    -- Divergence is expected (people register or delete accounts between the
    -- preview and the send) and is exactly what makes it worth recording both.
    previewed_count    INTEGER,
    notification_count INTEGER      NOT NULL DEFAULT 0,

    sent_by_user_id    INTEGER      NOT NULL REFERENCES public.hr_users(id) ON DELETE RESTRICT,
    -- Branch context the operator was acting in, for scope auditing.
    branch_id          INTEGER      REFERENCES public.branches(id) ON DELETE SET NULL,

    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at       TIMESTAMPTZ,
    last_error         TEXT
);

ALTER TABLE public.app_notification_broadcasts
  DROP CONSTRAINT IF EXISTS app_notification_broadcasts_text_ck,
  ADD  CONSTRAINT app_notification_broadcasts_text_ck
    CHECK (length(btrim(title)) > 0 AND length(btrim(message)) > 0);

ALTER TABLE public.app_notification_broadcasts
  DROP CONSTRAINT IF EXISTS app_notification_broadcasts_destination_ck,
  ADD  CONSTRAINT app_notification_broadcasts_destination_ck
    CHECK (destination IS NULL OR destination IN
      ('service_request', 'device', 'warranty', 'complaint', 'visit'));

CREATE INDEX IF NOT EXISTS app_notification_broadcasts_recent_idx
  ON public.app_notification_broadcasts (created_at DESC, id DESC);

-- Ties each delivered notification back to the send that produced it, so the
-- "to whom" in the audit trail is the actual recipient list rather than a
-- filter that may no longer resolve to the same people.
ALTER TABLE public.app_notifications
  ADD COLUMN IF NOT EXISTS broadcast_id BIGINT
    REFERENCES public.app_notification_broadcasts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS app_notifications_broadcast_idx
  ON public.app_notifications (broadcast_id)
  WHERE broadcast_id IS NOT NULL;

-- Dedicated keys, NOT settings.manage (D-N6): addressing thousands of customers
-- is not the same kind of act as editing a configuration value, and the two
-- should not be grantable together by accident.
--
-- BRANCH is allowed because the audience filter is bounded by branch coverage
-- (D-N7) — a branch operator announcing an outage in their own area is the
-- primary use case, not an exception to it.
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
 ('admin.app_notifications.view', 'admin', 'app_notifications', 'view',
  'عرض سجل إشعارات التطبيق المرسلة', 304, ARRAY['GLOBAL','BRANCH']),
 ('admin.app_notifications.send', 'admin', 'app_notifications', 'send',
  'إرسال إشعار حر لعملاء التطبيق', 305, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE SET module = EXCLUDED.module, sub_module = EXCLUDED.sub_module,
 action = EXCLUDED.action, display_name = EXCLUDED.display_name,
 display_order = EXCLUDED.display_order, allowed_scopes = EXCLUDED.allowed_scopes;

COMMIT;
