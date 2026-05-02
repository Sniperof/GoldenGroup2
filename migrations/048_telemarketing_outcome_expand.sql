-- ============================================================
-- Migration 048: Expand telemarketing_call_logs.outcome CHECK constraint
--
-- Replaces the original 4-value CHECK with the full MVP outcome list.
-- The expanded outcome codes are longer than the original varchar(20)
-- columns, so widen the storage before adding/using the expanded values.
-- ============================================================

ALTER TABLE telemarketing_call_logs
  ALTER COLUMN outcome TYPE VARCHAR(50);

ALTER TABLE telemarketing_task_list_items
  ALTER COLUMN call_outcome TYPE VARCHAR(50);

-- The original constraint name from migration 001 may vary across
-- environments, so we use a regex-based approach to find and drop it.
-- PostgreSQL auto-names it: telemarketing_call_logs_outcome_check

ALTER TABLE telemarketing_call_logs
  DROP CONSTRAINT IF EXISTS telemarketing_call_logs_outcome_check;

ALTER TABLE telemarketing_call_logs
  ADD CONSTRAINT telemarketing_call_logs_outcome_check
  CHECK (outcome IN (
    -- Legacy values (kept for backward compatibility)
    'no_answer',
    'busy',
    'rejected',
    'booked',
    -- Group 1: Not reached
    'out_of_coverage',
    'not_in_service',
    'wrong_number',
    'auto_disconnected',
    -- Group 2: Reached — no appointment
    'currently_busy',
    'interrupted',
    'not_interested',
    'other_company_not_interested',
    'seen_offer_not_interested',
    'address_updated',
    -- Group 3: Reached — follow-up
    'other_company_callback',
    'seen_offer_callback',
    -- Group 4: Reached — service / transfer
    'service_request',
    'company_customer_missing_phone',
    -- Group 5: Appointment booking
    'booked_marketing_appointment'
  ));
