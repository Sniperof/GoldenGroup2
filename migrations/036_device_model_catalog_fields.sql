-- ============================================================
-- Migration 036: Device model catalog fields
-- Extends device model records with pricing, warranty, offers,
-- descriptions, and media/document attachments.
-- ============================================================

ALTER TABLE device_models
  DROP CONSTRAINT IF EXISTS device_models_category_check;

ALTER TABLE device_models
  ADD COLUMN IF NOT EXISTS name_ar VARCHAR(255),
  ADD COLUMN IF NOT EXISTS name_en VARCHAR(255),
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discounted_price NUMERIC,
  ADD COLUMN IF NOT EXISTS is_golden_warranty BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS golden_warranty_periods JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_offer_included BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS primary_image_id TEXT,
  ADD COLUMN IF NOT EXISTS videos JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE device_models
   SET name_ar = COALESCE(NULLIF(name_ar, ''), name),
       name_en = COALESCE(NULLIF(name_en, ''), brand),
       discounted_price = COALESCE(discounted_price, base_price)
 WHERE name_ar IS NULL
    OR name_en IS NULL
    OR discounted_price IS NULL;
