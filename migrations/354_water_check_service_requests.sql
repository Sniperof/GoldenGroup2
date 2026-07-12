-- ============================================================
-- 354_water_check_service_requests.sql
-- ============================================================
-- Adds the minimal request-type infrastructure needed for mobile
-- water-check intake without splitting away from service_requests.
-- Existing rows remain emergency_maintenance by default.
-- ============================================================

BEGIN;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS request_type VARCHAR(80) NOT NULL DEFAULT 'emergency_maintenance',
  ADD COLUMN IF NOT EXISTS submitted_payload JSONB,
  ADD COLUMN IF NOT EXISTS branch_resolution_status VARCHAR(40) NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS branch_resolution_reason TEXT,
  ADD COLUMN IF NOT EXISTS branch_resolution_geo_unit_id INTEGER
    REFERENCES public.geo_units(id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE public.service_requests
    ADD CONSTRAINT service_requests_branch_resolution_status_check
      CHECK (branch_resolution_status IN (
        'not_applicable',
        'resolved',
        'ambiguous',
        'no_coverage',
        'missing_geo'
      ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS service_requests_type_status_created_idx
  ON public.service_requests (request_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS service_requests_branch_resolution_idx
  ON public.service_requests (branch_resolution_status, branch_resolution_geo_unit_id);

COMMENT ON COLUMN public.service_requests.request_type IS
  'Business request type routed through the unified intake layer. Default keeps legacy maintenance rows unchanged.';

COMMENT ON COLUMN public.service_requests.submitted_payload IS
  'Immutable request-form payload as received/normalized at intake, used for mobile/web request templates.';

COMMENT ON COLUMN public.service_requests.branch_resolution_status IS
  'Result of automatic branch resolution from request geography: resolved, ambiguous, no_coverage, missing_geo, or not_applicable.';

COMMENT ON COLUMN public.service_requests.branch_resolution_reason IS
  'Human-readable/diagnostic explanation for branch auto-resolution.';

COMMENT ON COLUMN public.service_requests.branch_resolution_geo_unit_id IS
  'Deepest geo unit used to resolve the branch for this service request.';

COMMIT;
