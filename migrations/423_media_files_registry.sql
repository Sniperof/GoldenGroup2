-- ============================================================
-- 423_media_files_registry.sql — unified media store
-- ============================================================
-- One registry row per stored file under MEDIA_DIR. Replaces two bad habits:
--   1. base64 data: URLs inlined into device_models.images / branches.images,
--      which bloated every row and every list query;
--   2. /uploads/<epoch>_<originalname> files that nothing ever tracked, so
--      orphans accumulated forever with no way to tell what was still in use.
--
-- The registry is what makes deletion possible: an entity save records which
-- media it references (owner_type/owner_id), and anything unreferenced can be
-- reclaimed safely.
--
-- Files live at MEDIA_DIR/<id[0:2]>/<id[2:4]>/<public_id>.<ext> — the shard is
-- derived from the id, so serving needs no DB lookup.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.media_files (
  id            BIGSERIAL PRIMARY KEY,
  -- 12-char base62, unguessable; appears verbatim in the public URL /m/<public_id>.<ext>
  public_id     VARCHAR(16)  NOT NULL UNIQUE,
  kind          VARCHAR(10)  NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  extension     VARCHAR(10)  NOT NULL,
  byte_size     INTEGER      NOT NULL,
  width         INTEGER,
  height        INTEGER,
  has_thumbnail BOOLEAN      NOT NULL DEFAULT FALSE,
  -- sha256 of the STORED bytes (post-normalisation), not the upload
  checksum      CHAR(64)     NOT NULL,
  original_name VARCHAR(255),
  owner_type    VARCHAR(30),
  owner_id      BIGINT,
  uploaded_by   INTEGER,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  attached_at   TIMESTAMPTZ,
  -- set when the file stops being referenced by its owner; the GC grace period
  -- runs from here so an accidental removal can still be undone
  detached_at   TIMESTAMPTZ
);

ALTER TABLE public.media_files
  DROP CONSTRAINT IF EXISTS media_files_kind_ck,
  ADD  CONSTRAINT media_files_kind_ck CHECK (kind IN ('image', 'video', 'document'));

ALTER TABLE public.media_files
  DROP CONSTRAINT IF EXISTS media_files_public_id_ck,
  ADD  CONSTRAINT media_files_public_id_ck CHECK (public_id ~ '^[A-Za-z0-9]{8,16}$');

ALTER TABLE public.media_files
  DROP CONSTRAINT IF EXISTS media_files_owner_ck,
  ADD  CONSTRAINT media_files_owner_ck CHECK (
    (owner_type IS NULL AND owner_id IS NULL)
    OR (owner_type IS NOT NULL AND owner_id IS NOT NULL)
  );

ALTER TABLE public.media_files
  DROP CONSTRAINT IF EXISTS media_files_owner_type_ck,
  ADD  CONSTRAINT media_files_owner_type_ck CHECK (
    owner_type IS NULL OR owner_type IN ('device_model', 'branch', 'app_home_banner')
  );

-- GC sweep 1: uploaded but never attached to anything.
CREATE INDEX IF NOT EXISTS idx_media_files_unattached
  ON public.media_files (created_at)
  WHERE owner_type IS NULL AND detached_at IS NULL;

-- GC sweep 2: removed from its owner, past the grace period.
CREATE INDEX IF NOT EXISTS idx_media_files_detached
  ON public.media_files (detached_at)
  WHERE detached_at IS NOT NULL;

-- Ownership sync reads every file currently owned by one entity.
CREATE INDEX IF NOT EXISTS idx_media_files_owner
  ON public.media_files (owner_type, owner_id)
  WHERE owner_type IS NOT NULL;

-- Duplicate REPORTING and integrity audits. Not used to share one stored file
-- between two entities: a row carries a single owner, so a shared file would be
-- reclaimed by the GC as soon as its owner released it, breaking the other
-- entity's image. One upload, one file.
CREATE INDEX IF NOT EXISTS idx_media_files_checksum
  ON public.media_files (checksum);

-- Banners were pinned to /uploads/ by migration 422; allow the new /m/ form too.
-- Both are accepted during the transition — 422's files are still served.
ALTER TABLE public.app_home_banners
  DROP CONSTRAINT IF EXISTS app_home_banners_image_url_ck,
  ADD  CONSTRAINT app_home_banners_image_url_ck
    CHECK (
      image_url ~ '^/uploads/[A-Za-z0-9._-]+$'
      OR image_url ~ '^/m/[A-Za-z0-9]{8,16}(_t)?\.[a-z0-9]{2,5}$'
    );

COMMIT;
