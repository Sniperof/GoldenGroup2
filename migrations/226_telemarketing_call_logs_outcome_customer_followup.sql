-- ============================================================
-- Migration 226: Add customer_requested_followup to outcome CHECK constraint
-- ============================================================
-- Constitution source:
--   DEC-004 D22 / DEC-006 D39 — customer_requested_followup outcome
--
-- Conservative Additive strategy (matches Phase 1):
--   The 4 outcomes that DEC-006 D39 marks for removal
--     (other_company_not_interested, seen_offer_not_interested,
--      other_company_callback, seen_offer_callback)
--   are KEPT in the CHECK list so historical telemarketing_call_logs rows
--   remain valid. They are filtered out of the UI selection list at the
--   application layer (packages/shared/telemarketingOutcomes.ts) following
--   the same pattern as the legacy 'rejected' / 'booked' codes.
--   Final DROP of these 4 from the CHECK constraint is scheduled for Phase 9
--   (Legacy Removal) after we backfill historical rows.
-- ============================================================

ALTER TABLE telemarketing_call_logs
  DROP CONSTRAINT IF EXISTS telemarketing_call_logs_outcome_check;

ALTER TABLE telemarketing_call_logs
  ADD CONSTRAINT telemarketing_call_logs_outcome_check
  CHECK (outcome::text = ANY (ARRAY[
    -- Group 1: not_reached
    'no_answer',
    'busy',
    'out_of_coverage',
    'not_in_service',
    'wrong_number',
    'auto_disconnected',
    -- Group 2: reached (no appointment)
    'currently_busy',
    'interrupted',
    'not_interested',
    'address_updated',
    -- Group 3: follow-up (NEW per DEC-006 D39)
    'customer_requested_followup',
    -- Group 4: service request
    'service_request',
    'company_customer_missing_phone',
    -- Group 5: booked
    'booked_marketing_appointment',
    -- Free call: data update
    'new_number',
    'message_sent',
    -- Legacy (retained until Phase 9 backfill)
    'other_company_not_interested',
    'seen_offer_not_interested',
    'other_company_callback',
    'seen_offer_callback',
    'rejected',
    'booked'
  ]::text[]));

COMMENT ON CONSTRAINT telemarketing_call_logs_outcome_check ON telemarketing_call_logs IS
  'DEC-006 D39 outcome vocabulary. Active outcomes: 16. Legacy outcomes (other_company_*, seen_offer_*, rejected, booked) retained for historical rows; will be dropped in Phase 9 after backfill.';
