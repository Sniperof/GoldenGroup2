-- ============================================================
-- Migration 218: Seed system_lists categories from DEC-004 + DEC-006
-- ============================================================
-- Constitution source:
--   DEC-004 D8  — visit_cancellation_reasons
--   DEC-004 D15 — visit_task_reasons
--   DEC-004 D17 — location_missing_reasons
--   DEC-004 D22 — customer_followup_reasons
--   DEC-006 D39 — customer_followup_reasons (reaffirmed), cooldown_manual_reasons,
--                  visit_not_completed_reasons, not_interested_reasons (optional)
--
-- Q-A decision (P-DEC006-01 pending):
--   Seed each new category with the minimum "أخرى" placeholder only.
--   Full seed values will be defined in a later session.
--
-- Anti-duplication note:
--   migration 215 already created `area_evaluation_options` (4 values) and
--   `survey_skip_reasons` ("أخرى" only). These are NOT re-seeded here.
--   migrations 098 created `telemarketing_rejection_reason` and
--   `telemarketing_reschedule_reason` — those will be REMOVED later in
--   Phase 2 (DEC-006 D39); this migration only ADDS new categories.
-- ============================================================

INSERT INTO system_lists (category, value, is_active, display_order) VALUES
    -- DEC-004 D22 + DEC-006 D39: required for customer_requested_followup outcome
    ('customer_followup_reasons', 'أخرى', TRUE, 99),

    -- DEC-004 D8: required when cancelling a scheduled field_visit
    ('visit_cancellation_reasons', 'أخرى', TRUE, 99),

    -- DEC-004 D17: required when GPS missing during start/end
    ('location_missing_reasons', 'أخرى', TRUE, 99),

    -- DEC-006 D39: required when activating cooldown manually
    ('cooldown_manual_reasons', 'أخرى', TRUE, 99),

    -- DEC-006 D39: required when documenting visit as not_completed
    ('visit_not_completed_reasons', 'أخرى', TRUE, 99),

    -- DEC-006 D39: optional reporting category for not_interested outcome
    ('not_interested_reasons', 'أخرى', TRUE, 99),

    -- DEC-004 D15: required when visit_task result is not_completed
    ('visit_task_reasons', 'أخرى', TRUE, 99)
ON CONFLICT (category, value) DO NOTHING;
