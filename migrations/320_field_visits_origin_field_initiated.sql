-- ============================================================
-- 320_field_visits_origin_field_initiated.sql
-- ============================================================
-- DEC-011 (Field-Initiated Instant Visit): a supervisor/team starts an off-plan
-- visit on the spot. Such visits carry origin_type = 'field_initiated' so they
-- are distinguishable in the source/out-of-plan reporting (DEC-004 D13).
-- Extend the existing origin_type CHECK to allow the new value.
-- Idempotent.
-- ============================================================

ALTER TABLE public.field_visits
  DROP CONSTRAINT IF EXISTS field_visits_origin_type_check;

ALTER TABLE public.field_visits
  ADD CONSTRAINT field_visits_origin_type_check
  CHECK (
    origin_type IS NULL
    OR (origin_type)::text = ANY (ARRAY[
      'telemarketing'::text,
      'expected_followup'::text,
      'manual'::text,
      'emergency_request'::text,
      'system'::text,
      'field_initiated'::text
    ])
  );
