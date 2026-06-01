-- ============================================================
-- 235_device_demo_result_model.sql
-- ============================================================
-- Foundation for the unified result model. Specifically:
--   1. Extend visit_task_device_demo_results with reason_code_id + closing_notes
--      so rescheduled/cancelled results can store their reason + notes
--      without polluting the offer fields.
--   2. Realign task_type_config['device_demo'] so the planning window is
--      based on due_date in the 'open' state (the needs_follow_up window
--      stays universal at 1 day → expected_date per DEC-006 D36).
--
-- No new system_lists categories are seeded — the admin creates
-- `offer_refusal_reasons` from the /system-lists UI when needed.
-- Existing categories are reused:
--   - rescheduled → customer_followup_reasons (DEC-006 D39)
--   - cancelled   → visit_cancellation_reasons (DEC-006 D39)
--
-- Reference: docs/constitution/features/tasks/device-demo.md
-- ============================================================

BEGIN;

-- 1) Side-table extensions for rescheduled / cancelled outcomes
ALTER TABLE public.visit_task_device_demo_results
  ADD COLUMN IF NOT EXISTS reason_code_id INTEGER
    REFERENCES public.system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closing_notes TEXT;

COMMENT ON COLUMN public.visit_task_device_demo_results.reason_code_id IS
  'FK to system_lists. Resolved per final_decision: rescheduled → customer_followup_reasons; cancelled → visit_cancellation_reasons. NULL for offer_presented / device_sold.';

COMMENT ON COLUMN public.visit_task_device_demo_results.closing_notes IS
  'Free-text notes captured at result time. Mandatory when the chosen reason is "other".';

-- 2) Realign device_demo scheduling: due_date-based window in open state.
--    Fix arabic_label mojibake at the same time.
UPDATE public.task_type_config
SET scheduling_pattern   = 'short_window',
    window_basis         = 'due_date',
    planning_window_days = 7,
    arabic_label         = 'عرض جهاز',
    updated_at           = NOW()
WHERE task_type = 'device_demo';

COMMIT;
