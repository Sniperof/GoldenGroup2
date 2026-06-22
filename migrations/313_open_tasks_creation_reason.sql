-- ============================================================
-- 313_open_tasks_creation_reason.sql
-- ============================================================
-- Dedicated column for the task creation reason (distinct from `reason`, which is
-- constrained to the open_task_reasons enum). Used by the golden-warranty create
-- modals (golden_offer_creation_reasons / golden_card_creation_reasons) so the
-- reason is structured rather than folded into notes. DEC-CT-17.
--
-- Idempotent / safe to re-run.
-- ============================================================

ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS creation_reason VARCHAR(255);
