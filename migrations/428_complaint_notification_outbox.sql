-- ============================================================
-- 428_complaint_notification_outbox.sql — Complaints join the outbox
-- ============================================================
-- DEC-019 D-N16, amending DEC-018 D-C9/D-C12 (which excluded automatic
-- notifications from complaints V1). The amendment is narrow: app-inbox
-- notifications only. SMS, WhatsApp and email stay excluded exactly as before.
--
-- The trigger deliberately watches `complaint_public_updates`, NOT
-- `complaints.status`:
--
--   * That table already IS the customer-facing channel. Every row in it is, by
--     definition, something we decided to tell the complainant — so the consumer
--     needs almost no filtering, and the text is already written and curated.
--   * Staff can publish a public update WITHOUT changing status (a progress note
--     or an explanation). A status trigger would never see those, and they are
--     often the messages that matter most.
--   * A resolution publishes a `public_summary` written by a person for this
--     specific complaint. No generated sentence competes with that.
--
-- Five call sites insert into that table (four in complaintService, one in
-- mobileComplaintService); one INSERT trigger covers all of them and anything
-- added later.
-- ============================================================

BEGIN;

-- The outbox now carries a third kind of source row.
ALTER TABLE public.app_notification_outbox
  DROP CONSTRAINT IF EXISTS app_notification_outbox_entity_type_ck,
  ADD  CONSTRAINT app_notification_outbox_entity_type_ck
    CHECK (entity_type IN ('service_request', 'field_visit', 'complaint_public_update'));

-- entity_id is the PUBLIC UPDATE's id, not the complaint's: the notification is
-- about that one published message, and two updates on one complaint are two
-- separate things to tell the customer.
CREATE OR REPLACE FUNCTION public.app_notification_outbox_capture_public_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.app_notification_outbox (entity_type, entity_id, from_status, to_status)
  VALUES ('complaint_public_update', NEW.id, NULL, NEW.public_status);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_notification_outbox_complaint_updates ON public.complaint_public_updates;
CREATE TRIGGER app_notification_outbox_complaint_updates
  AFTER INSERT ON public.complaint_public_updates
  FOR EACH ROW EXECUTE FUNCTION public.app_notification_outbox_capture_public_update();

COMMIT;
