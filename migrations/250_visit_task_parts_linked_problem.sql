-- ============================================================
-- 250_visit_task_parts_linked_problem.sql
-- ============================================================
-- Phase 6a.1 — Link a used part to a specific diagnosed problem.
--
-- Per maintenance.md §١١.أ + §٠.١٩.ز:
--   The wizard (Phase 6c) will let the technician attach each
--   spare part to the problem it addresses. This enables:
--     - Per-problem cost reporting (which problem cost the most?)
--     - Workshop-routing pre-check (which problems consumed
--       non-Periodic parts vs Periodic?)
--     - Defer-to-warranty calculation per problem
--
-- The link is OPTIONAL (NULL allowed) — parts can be used for
-- general maintenance not bound to a specific problem in the list.
--
-- ON DELETE SET NULL: if a problem is soft-deleted/cancelled,
-- the part record stays for audit; only the link clears.
-- (Soft delete still leaves the row in service_request_problems
-- per EM-PROB-01; this FK protection covers the rare DELETE case.)
-- ============================================================

BEGIN;

ALTER TABLE public.visit_task_emergency_parts_used
  ADD COLUMN IF NOT EXISTS linked_problem_id BIGINT
    REFERENCES public.service_request_problems(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS visit_task_parts_linked_problem_idx
  ON public.visit_task_emergency_parts_used (linked_problem_id)
  WHERE linked_problem_id IS NOT NULL;

COMMENT ON COLUMN public.visit_task_emergency_parts_used.linked_problem_id IS
  'Optional FK to the specific diagnosed problem this part addresses. NULL = general maintenance not bound to a list item. Per §١١.أ.';

COMMIT;
