-- Distinguish an installed device from a public catalog model in notification
-- destinations, and add the request-form value omitted by migration 429.

BEGIN;

ALTER TABLE public.app_notification_broadcasts
  DROP CONSTRAINT IF EXISTS app_notification_broadcasts_destination_ck,
  ADD CONSTRAINT app_notification_broadcasts_destination_ck
    CHECK (destination IS NULL OR destination IN
      ('service_request', 'device', 'catalog_device', 'warranty', 'complaint', 'visit', 'service_request_form'));

COMMIT;
