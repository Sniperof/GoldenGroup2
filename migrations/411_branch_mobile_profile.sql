BEGIN;

ALTER TABLE branches
  ADD COLUMN mobile_visible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN mobile_display_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN public_description TEXT,
  ADD COLUMN images JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN primary_image_id TEXT,
  ADD COLUMN latitude DOUBLE PRECISION,
  ADD COLUMN longitude DOUBLE PRECISION;

ALTER TABLE branches
  ADD CONSTRAINT branches_mobile_display_order_check
    CHECK (mobile_display_order >= 0),
  ADD CONSTRAINT branches_images_array_check
    CHECK (jsonb_typeof(images) = 'array'),
  ADD CONSTRAINT branches_map_location_pair_check
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT branches_latitude_range_check
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT branches_longitude_range_check
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

CREATE INDEX branches_mobile_catalog_order_idx
  ON branches (mobile_display_order, name, id)
  WHERE status = 'active' AND mobile_visible = TRUE;

COMMIT;
