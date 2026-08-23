-- ============================================================
-- 427_app_notification_outbox.sql — Status-change outbox (DEC-019 D-N15)
-- ============================================================
-- Solves the dual-write problem behind the notification layer: changing a row
-- and telling a customer over the network cannot be made atomic, so one of the
-- two always loses on a crash. Writing the FACT of the change into a table CAN
-- be atomic with the change itself; a separate worker then turns that row into
-- a push, retrying as often as it needs to.
--
-- Why a trigger instead of calls in the services: the status of a service
-- request is written in 13 places across 9 files (7 of which set 'promoted'
-- without passing through stateMachine.ts), and a visit's status in 7 places
-- across 3 files. A forgotten call site produces no error — only a customer who
-- is never told. The database observing its own column cannot forget, and
-- covers writers added later by people who never heard of notifications.
--
-- The trigger captures EVERY status change, including purely internal ones. The
-- consumer decides which deserve a notification (services/appNotifications/
-- outboxConsumer.ts). That asymmetry is deliberate: a filter mistake shows up
-- as an extra notification, which someone complains about, while a missing call
-- site shows up as silence, which nobody ever notices.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_notification_outbox (
    id            BIGSERIAL   PRIMARY KEY,

    -- 'service_request' | 'field_visit'. Not a FK: the outbox outlives its
    -- source row and must survive a hard delete of it.
    entity_type   VARCHAR(30) NOT NULL,
    entity_id     BIGINT      NOT NULL,

    -- NULL on INSERT capture: there was no previous status.
    from_status   VARCHAR(40),
    to_status     VARCHAR(40) NOT NULL,

    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Set when the consumer is DONE with the row, whether it produced a
    -- notification or deliberately skipped it. Both are "handled".
    processed_at  TIMESTAMPTZ,
    -- Why nothing was produced, when that was the outcome. Kept for the
    -- question "the customer says they got no alert — did we even consider it?"
    skip_reason   VARCHAR(60),

    attempts      SMALLINT    NOT NULL DEFAULT 0,
    last_error    TEXT
);

ALTER TABLE public.app_notification_outbox
  DROP CONSTRAINT IF EXISTS app_notification_outbox_entity_type_ck,
  ADD  CONSTRAINT app_notification_outbox_entity_type_ck
    CHECK (entity_type IN ('service_request', 'field_visit'));

-- The only hot query: the pending queue, oldest first. Partial, so the index
-- stays the size of the backlog instead of the size of history.
CREATE INDEX IF NOT EXISTS app_notification_outbox_pending_idx
  ON public.app_notification_outbox (id)
  WHERE processed_at IS NULL;

-- For answering "what happened to entity X" without scanning.
CREATE INDEX IF NOT EXISTS app_notification_outbox_entity_idx
  ON public.app_notification_outbox (entity_type, entity_id, id DESC);

-- ── capture trigger ─────────────────────────────────────────
-- Runs inside the writer's own transaction, so the outbox row and the status
-- change commit or roll back together. That single property is the reason this
-- exists; nothing here may be moved to an AFTER COMMIT hook.
CREATE OR REPLACE FUNCTION public.app_notification_outbox_capture()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.app_notification_outbox (entity_type, entity_id, from_status, to_status)
    VALUES (TG_ARGV[0], NEW.id, NULL, NEW.status);
    RETURN NEW;
  END IF;

  -- `UPDATE OF status` also fires when status is in the SET list but unchanged
  -- (a common shape when a query sets several columns at once), so the real
  -- change test lives here. IS DISTINCT FROM, not <>, because either side may
  -- be NULL and <> would silently drop that transition.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.app_notification_outbox (entity_type, entity_id, from_status, to_status)
    VALUES (TG_ARGV[0], NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_notification_outbox_service_requests ON public.service_requests;
CREATE TRIGGER app_notification_outbox_service_requests
  AFTER UPDATE OF status ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.app_notification_outbox_capture('service_request');

DROP TRIGGER IF EXISTS app_notification_outbox_field_visits_upd ON public.field_visits;
CREATE TRIGGER app_notification_outbox_field_visits_upd
  AFTER UPDATE OF status ON public.field_visits
  FOR EACH ROW EXECUTE FUNCTION public.app_notification_outbox_capture('field_visit');

-- Visits are born 'scheduled' — the notifiable moment is the INSERT, not a
-- later transition. Service requests are born 'received', which is never
-- notifiable, so they get no INSERT trigger and no per-intake outbox row.
DROP TRIGGER IF EXISTS app_notification_outbox_field_visits_ins ON public.field_visits;
CREATE TRIGGER app_notification_outbox_field_visits_ins
  AFTER INSERT ON public.field_visits
  FOR EACH ROW EXECUTE FUNCTION public.app_notification_outbox_capture('field_visit');

COMMIT;
