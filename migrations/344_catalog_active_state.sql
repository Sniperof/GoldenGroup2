-- 344_catalog_active_state.sql
-- Separate catalog availability from soft deletion for device models and spare parts.

BEGIN;

ALTER TABLE public.device_models
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.spare_parts
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.device_models.is_active IS
  'Catalog availability flag. FALSE means unavailable for new commercial use, not soft-deleted.';

COMMENT ON COLUMN public.spare_parts.is_active IS
  'Catalog availability flag. FALSE means unavailable for new commercial use, not soft-deleted.';

CREATE INDEX IF NOT EXISTS idx_device_models_active_not_deleted
  ON public.device_models (is_active, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_spare_parts_active_not_deleted
  ON public.spare_parts (is_active, id)
  WHERE deleted_at IS NULL;

COMMIT;
