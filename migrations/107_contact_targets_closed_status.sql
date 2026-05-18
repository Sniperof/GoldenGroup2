-- 107_contact_targets_closed_status.sql
-- Aligns contact_targets.status with constitution AP-R007 / PC-G004:
-- "الجهة المرتبطة بالموعد تُغلق بسبب نتيجة الحجز"
--
-- The reason for closure is preserved in the existing `latest_call_outcome`
-- column (e.g., 'booked_marketing_appointment'). No schema change needed —
-- only a data migration that transitions stale 'booked' rows to 'closed'.

BEGIN;

UPDATE contact_targets
   SET status = 'closed',
       updated_at = NOW()
 WHERE status = 'booked';

COMMIT;
