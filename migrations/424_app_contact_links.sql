BEGIN;

-- Mobile contact/social links are one global, admin-managed configuration.
-- A nullable value means that the corresponding action is hidden in the app.
CREATE TABLE IF NOT EXISTS public.app_contact_links (
  id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  facebook_url      TEXT,
  website_url       TEXT,
  instagram_url     TEXT,
  whatsapp_number   VARCHAR(16),
  telegram_number   VARCHAR(16),
  updated_by        INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT app_contact_links_facebook_url_ck
    CHECK (facebook_url IS NULL OR facebook_url ~ '^https://[^[:space:]]+$'),
  CONSTRAINT app_contact_links_website_url_ck
    CHECK (website_url IS NULL OR website_url ~ '^https://[^[:space:]]+$'),
  CONSTRAINT app_contact_links_instagram_url_ck
    CHECK (instagram_url IS NULL OR instagram_url ~ '^https://[^[:space:]]+$'),
  CONSTRAINT app_contact_links_whatsapp_number_ck
    CHECK (whatsapp_number IS NULL OR whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT app_contact_links_telegram_number_ck
    CHECK (telegram_number IS NULL OR telegram_number ~ '^\+[1-9][0-9]{7,14}$')
);

INSERT INTO public.app_contact_links (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('admin.app_contact_links.view',   'admin', 'app_contact_links', 'view',
   'عرض روابط التواصل الخاصة بالتطبيق', 304, ARRAY['GLOBAL']),
  ('admin.app_contact_links.manage', 'admin', 'app_contact_links', 'manage',
   'إدارة روابط التواصل الخاصة بالتطبيق', 305, ARRAY['GLOBAL'])
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

COMMIT;
