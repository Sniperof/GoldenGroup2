-- ============================================================
-- 261 — service_request_problems.no_resolve_reason
-- ============================================================
-- Adds a structured reason for deferred/unresolvable_field problems
-- so dashboards can categorize *why* problems weren't resolved.
-- Stored as TEXT (enum-like values driven by frontend dropdown).
-- Allowed values (V1): awaiting_parts | customer_busy | needs_lab | other
-- ============================================================

ALTER TABLE public.service_request_problems
  ADD COLUMN IF NOT EXISTS no_resolve_reason TEXT;

COMMENT ON COLUMN public.service_request_problems.no_resolve_reason IS
  'Structured reason when status is deferred/unresolvable_field. Allowed: awaiting_parts|customer_busy|needs_lab|other';
