-- Conservatively restore contact context for existing telemarketing bookings.
-- A match is accepted only for the same customer and telemarketer, with the
-- booked call occurring within two minutes of field_visits.appointment_booked_at.

WITH matched_customer_calls AS (
  SELECT
    fv.id AS field_visit_id,
    matched.answered_by,
    matched.notes
  FROM public.field_visits fv
  CROSS JOIN LATERAL (
    SELECT ccl.answered_by, ccl.notes
      FROM public.customer_call_logs ccl
     WHERE ccl.customer_id = fv.client_id
       AND ccl.outcome = 'booked_marketing_appointment'
       AND (
         fv.booked_by_telemarketer_id IS NULL
         OR ccl.caller_id IS NOT DISTINCT FROM fv.booked_by_telemarketer_id
       )
       AND ABS(EXTRACT(EPOCH FROM (fv.appointment_booked_at - ccl.call_date))) <= 120
     ORDER BY ABS(EXTRACT(EPOCH FROM (fv.appointment_booked_at - ccl.call_date)))
     LIMIT 1
  ) matched
  WHERE fv.origin_type = 'telemarketing'
    AND fv.appointment_booked_at IS NOT NULL
)
UPDATE public.field_visits fv
   SET answered_by = COALESCE(fv.answered_by, matched.answered_by),
       -- Before migration 402, the booking UI sent "instructions for the
       -- technician" through telemarketer_notes. Preserve them under the new,
       -- semantically correct field before restoring the actual call notes.
       field_instructions = COALESCE(
         fv.field_instructions,
         NULLIF(BTRIM(fv.telemarketer_notes), '')
       ),
       telemarketer_notes = NULLIF(BTRIM(matched.notes), '')
  FROM matched_customer_calls matched
 WHERE fv.id = matched.field_visit_id;

WITH matched_telemarketing_calls AS (
  SELECT
    fv.id AS field_visit_id,
    matched.id AS call_log_id
  FROM public.field_visits fv
  CROSS JOIN LATERAL (
    SELECT tcl.id
      FROM public.telemarketing_call_logs tcl
     WHERE tcl.entity_type = 'client'
       AND tcl.entity_id = fv.client_id
       AND tcl.outcome = 'booked_marketing_appointment'
       AND (
         fv.booked_by_telemarketer_id IS NULL
         OR tcl.called_by IS NOT DISTINCT FROM fv.booked_by_telemarketer_id
       )
       AND ABS(EXTRACT(EPOCH FROM (fv.appointment_booked_at - tcl."timestamp"))) <= 120
     ORDER BY ABS(EXTRACT(EPOCH FROM (fv.appointment_booked_at - tcl."timestamp")))
     LIMIT 1
  ) matched
  WHERE fv.origin_type = 'telemarketing'
    AND fv.appointment_booked_at IS NOT NULL
    AND fv.booking_call_log_id IS NULL
)
UPDATE public.field_visits fv
   SET booking_call_log_id = matched.call_log_id
  FROM matched_telemarketing_calls matched
 WHERE fv.id = matched.field_visit_id;

ALTER TABLE public.field_visits
  VALIDATE CONSTRAINT field_visits_answered_by_check;
