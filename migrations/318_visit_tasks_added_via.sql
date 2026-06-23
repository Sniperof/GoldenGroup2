-- ============================================================
-- 318_visit_tasks_added_via.sql
-- ============================================================
-- DEC-010 (Visit Task Pull): distinguish an original visit_task (created at
-- booking time, the reason the visit exists) from one PULLED into an
-- in_progress visit. The undo-pull guard (D-PB8.2) may only remove a pulled
-- task, never an original one.
--
-- 'booking' = created by bookVisit() when the visit was scheduled.
-- 'pull'    = added via POST /field-visits/:id/tasks during in_progress.
--
-- Existing rows default to 'booking' (safe: undo-pull will refuse them).
-- ============================================================

ALTER TABLE public.visit_tasks
  ADD COLUMN IF NOT EXISTS added_via VARCHAR(16) NOT NULL DEFAULT 'booking';

ALTER TABLE public.visit_tasks
  DROP CONSTRAINT IF EXISTS visit_tasks_added_via_check;

ALTER TABLE public.visit_tasks
  ADD CONSTRAINT visit_tasks_added_via_check
  CHECK (added_via IN ('booking', 'pull'));
