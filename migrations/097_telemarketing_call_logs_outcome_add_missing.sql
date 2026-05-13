-- Add message_sent and new_number to the telemarketing_call_logs outcome CHECK constraint.
-- Both outcomes exist in telemarketingOutcomes.ts but were missing from the DB constraint,
-- causing a constraint violation when trying to insert call logs with these outcomes.

ALTER TABLE telemarketing_call_logs
  DROP CONSTRAINT telemarketing_call_logs_outcome_check;

ALTER TABLE telemarketing_call_logs
  ADD CONSTRAINT telemarketing_call_logs_outcome_check CHECK (outcome::text = ANY (ARRAY[
    'no_answer',
    'busy',
    'rejected',
    'booked',
    'out_of_coverage',
    'not_in_service',
    'wrong_number',
    'auto_disconnected',
    'currently_busy',
    'interrupted',
    'not_interested',
    'other_company_not_interested',
    'seen_offer_not_interested',
    'address_updated',
    'other_company_callback',
    'seen_offer_callback',
    'service_request',
    'company_customer_missing_phone',
    'booked_marketing_appointment',
    'new_number',
    'message_sent'
  ]::text[]));
