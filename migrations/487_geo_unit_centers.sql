-- 487: a map center for each geo unit (ناحية / حي).
--
-- The zone-study map draws one pin per area, placed on the area's center.
-- geo_units carried no coordinates (and clients/devices almost never carry
-- GPS), so the map had nothing to stand on. The center is set by the branch
-- (click on the map) or, later, by geocoding; center_source records which.
-- An area without a center still counts in the study table — it just has no
-- pin until someone places it.

BEGIN;

ALTER TABLE public.geo_units
  ADD COLUMN IF NOT EXISTS center_lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS center_lng NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS center_source VARCHAR(20),
  ADD COLUMN IF NOT EXISTS center_updated_by INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS center_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'geo_units_center_pair_check'
  ) THEN
    ALTER TABLE public.geo_units
      ADD CONSTRAINT geo_units_center_pair_check
        CHECK ((center_lat IS NULL) = (center_lng IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'geo_units_center_source_check'
  ) THEN
    ALTER TABLE public.geo_units
      ADD CONSTRAINT geo_units_center_source_check
        CHECK (center_source IS NULL OR center_source IN ('manual', 'geocode'));
  END IF;
END $$;

COMMENT ON COLUMN public.geo_units.center_lat IS 'Map center latitude of the area (zone-study pins).';
COMMENT ON COLUMN public.geo_units.center_lng IS 'Map center longitude of the area (zone-study pins).';
COMMENT ON COLUMN public.geo_units.center_source IS '''manual'' (placed on the map) or ''geocode''.';

COMMIT;
