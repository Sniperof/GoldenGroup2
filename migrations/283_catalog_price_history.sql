-- ============================================================
-- 283_catalog_price_history.sql
-- ============================================================
-- Historical catalog prices for device models and spare parts.
--
-- A catalog item has one effective price at any point in time. Contracts,
-- maintenance results, and installed-part rows must keep their own monetary
-- snapshot, while this history preserves catalog price changes over time.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.device_model_price_history (
  id BIGSERIAL PRIMARY KEY,
  device_model_id INTEGER NOT NULL REFERENCES public.device_models(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL CHECK (price > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'SYP',
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  note TEXT NULL,
  created_by INTEGER NULL REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT device_model_price_history_dates_ck
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT device_model_price_history_currency_ck
    CHECK (currency IN ('SYP'))
);

CREATE TABLE IF NOT EXISTS public.spare_part_price_history (
  id BIGSERIAL PRIMARY KEY,
  spare_part_id INTEGER NOT NULL REFERENCES public.spare_parts(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL CHECK (price > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'SYP',
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  note TEXT NULL,
  created_by INTEGER NULL REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT spare_part_price_history_dates_ck
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT spare_part_price_history_currency_ck
    CHECK (currency IN ('SYP'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_model_price_history_effective_from
  ON public.device_model_price_history(device_model_id, effective_from);

CREATE UNIQUE INDEX IF NOT EXISTS ux_spare_part_price_history_effective_from
  ON public.spare_part_price_history(spare_part_id, effective_from);

CREATE INDEX IF NOT EXISTS idx_device_model_price_history_lookup
  ON public.device_model_price_history(device_model_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_spare_part_price_history_lookup
  ON public.spare_part_price_history(spare_part_id, effective_from DESC);

INSERT INTO public.device_model_price_history
  (device_model_id, price, currency, effective_from, note, created_at)
SELECT dm.id, dm.base_price, 'SYP', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date,
       'Initial price history backfill', NOW()
FROM public.device_models dm
WHERE dm.deleted_at IS NULL
  AND dm.base_price > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.device_model_price_history ph
    WHERE ph.device_model_id = dm.id
  );

INSERT INTO public.spare_part_price_history
  (spare_part_id, price, currency, effective_from, note, created_at)
SELECT sp.id, sp.base_price, 'SYP', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date,
       'Initial price history backfill', NOW()
FROM public.spare_parts sp
WHERE sp.deleted_at IS NULL
  AND sp.base_price > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.spare_part_price_history ph
    WHERE ph.spare_part_id = sp.id
  );

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('devices.prices.view', 'devices', 'prices', 'view',
   'عرض سجل أسعار الأجهزة', 222, ARRAY['GLOBAL']),
  ('devices.prices.manage', 'devices', 'prices', 'manage',
   'إدارة أسعار الأجهزة', 223, ARRAY['GLOBAL']),
  ('spare_parts.prices.manage', 'devices', 'spare_part_prices', 'manage',
   'إدارة أسعار قطع الغيار', 224, ARRAY['GLOBAL'])
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

-- Existing catalog managers can see and manage prices during the transition.
WITH source_grants AS (
  SELECT role_id, (ARRAY_AGG(scope_type ORDER BY
    CASE scope_type::text
      WHEN 'GLOBAL' THEN 1
      WHEN 'BRANCH' THEN 2
      WHEN 'ASSIGNED' THEN 3
      ELSE 4
    END
  ))[1] AS scope_type
  FROM (
    SELECT rpg.role_id, rpg.scope_type
    FROM public.role_permission_grants rpg
    JOIN public.permissions p ON p.id = rpg.permission_id
    WHERE p.key IN ('catalog.manage', 'device_models.manage')
  ) grants
  GROUP BY role_id
),
target_permissions AS (
  SELECT id AS permission_id
  FROM public.permissions
  WHERE key IN ('devices.prices.view', 'devices.prices.manage')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.permission_id, 'GLOBAL'
FROM source_grants sg
CROSS JOIN target_permissions tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

WITH source_grants AS (
  SELECT role_id, (ARRAY_AGG(scope_type ORDER BY
    CASE scope_type::text
      WHEN 'GLOBAL' THEN 1
      WHEN 'BRANCH' THEN 2
      WHEN 'ASSIGNED' THEN 3
      ELSE 4
    END
  ))[1] AS scope_type
  FROM (
    SELECT rpg.role_id, rpg.scope_type
    FROM public.role_permission_grants rpg
    JOIN public.permissions p ON p.id = rpg.permission_id
    WHERE p.key IN ('catalog.manage', 'spare_parts.manage')
  ) grants
  GROUP BY role_id
),
target_permissions AS (
  SELECT id AS permission_id
  FROM public.permissions
  WHERE key = 'spare_parts.prices.manage'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.permission_id, 'GLOBAL'
FROM source_grants sg
CROSS JOIN target_permissions tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

COMMIT;
