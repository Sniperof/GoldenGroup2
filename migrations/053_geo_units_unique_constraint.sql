-- Prevent duplicate geo units at same level under same parent
-- Uses COALESCE for NULL parent_id (governorates) and LOWER for case-insensitive comparison
CREATE UNIQUE INDEX IF NOT EXISTS geo_units_name_level_parent_unique
  ON geo_units (LOWER(name), level, COALESCE(parent_id, 0));
