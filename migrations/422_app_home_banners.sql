-- ============================================================
-- 422_app_home_banners.sql — Mobile home-screen slider
-- ============================================================
-- One admin-managed table backing the rotating banner strip on the customer
-- app's home screen. Each row is one slide: an image, how long it stays on
-- screen, an optional publish window, and an optional tap target.
--
-- Tap targets are deliberately limited to things that exist for EVERY viewer:
--   device          -> device_models.id  (public catalog, /api/app/catalog/devices/:id)
--   service_request -> service_request_type_config.request_type (intake form)
-- A banner can NOT point at installed_devices: that row belongs to one customer,
-- while a banner is shown to all customers and to unauthenticated visitors.
--
-- Branch targeting and impression/click analytics were explicitly deferred.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_home_banners (
  id                     BIGSERIAL PRIMARY KEY,
  title_ar               VARCHAR(120),
  image_url              TEXT        NOT NULL,
  sort_order             INTEGER     NOT NULL DEFAULT 0,
  display_seconds        SMALLINT    NOT NULL DEFAULT 5,
  starts_at              TIMESTAMPTZ,
  ends_at                TIMESTAMPTZ,
  target_kind            VARCHAR(20) NOT NULL DEFAULT 'none',
  target_device_model_id INTEGER     REFERENCES public.device_models(id) ON DELETE RESTRICT,
  target_request_type    VARCHAR(80) REFERENCES public.service_request_type_config(request_type) ON DELETE RESTRICT,
  target_url             TEXT,
  audience               VARCHAR(20) NOT NULL DEFAULT 'all',
  is_active              BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by             INTEGER,
  updated_by             INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The image must be a file this server produced and serves from /uploads.
-- Without this an admin row could point the customer app at an arbitrary
-- external image (phishing surface inside a trusted app shell).
ALTER TABLE public.app_home_banners
  DROP CONSTRAINT IF EXISTS app_home_banners_image_url_ck,
  ADD  CONSTRAINT app_home_banners_image_url_ck
    CHECK (image_url ~ '^/uploads/[A-Za-z0-9._-]+$');

ALTER TABLE public.app_home_banners
  DROP CONSTRAINT IF EXISTS app_home_banners_display_seconds_ck,
  ADD  CONSTRAINT app_home_banners_display_seconds_ck
    CHECK (display_seconds BETWEEN 2 AND 60);

ALTER TABLE public.app_home_banners
  DROP CONSTRAINT IF EXISTS app_home_banners_audience_ck,
  ADD  CONSTRAINT app_home_banners_audience_ck
    CHECK (audience IN ('all', 'customers', 'guests'));

ALTER TABLE public.app_home_banners
  DROP CONSTRAINT IF EXISTS app_home_banners_window_ck,
  ADD  CONSTRAINT app_home_banners_window_ck
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);

-- Exactly the target columns that match target_kind are populated; the rest
-- are NULL. Prevents a half-defined target from ever reaching the app.
ALTER TABLE public.app_home_banners
  DROP CONSTRAINT IF EXISTS app_home_banners_target_ck,
  ADD  CONSTRAINT app_home_banners_target_ck CHECK (
    (target_kind = 'none'
       AND target_device_model_id IS NULL
       AND target_request_type IS NULL
       AND target_url IS NULL)
    OR (target_kind = 'device'
       AND target_device_model_id IS NOT NULL
       AND target_request_type IS NULL
       AND target_url IS NULL)
    OR (target_kind = 'service_request'
       AND target_request_type IS NOT NULL
       AND target_device_model_id IS NULL
       AND target_url IS NULL)
    OR (target_kind = 'external_url'
       AND target_url IS NOT NULL
       AND target_url ~ '^https://'
       AND target_device_model_id IS NULL
       AND target_request_type IS NULL)
  );

-- Read path is always "active slides in display order".
CREATE INDEX IF NOT EXISTS idx_app_home_banners_active
  ON public.app_home_banners (sort_order, id)
  WHERE is_active = TRUE;

INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
 ('admin.app_home_banners.view',   'admin', 'app_home_banners', 'view',   'عرض بانرات الشاشة الرئيسية للتطبيق',   302, ARRAY['GLOBAL']),
 ('admin.app_home_banners.manage', 'admin', 'app_home_banners', 'manage', 'إدارة بانرات الشاشة الرئيسية للتطبيق', 303, ARRAY['GLOBAL'])
ON CONFLICT (key) DO UPDATE SET module = EXCLUDED.module, sub_module = EXCLUDED.sub_module,
 action = EXCLUDED.action, display_name = EXCLUDED.display_name,
 display_order = EXCLUDED.display_order, allowed_scopes = EXCLUDED.allowed_scopes;

COMMIT;
