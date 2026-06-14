-- ============================================================
-- 274_devices_parts_permission_tree.sql
-- ============================================================
-- Introduce explicit device and spare-part permissions.
--
-- This keeps the legacy broad-management grants working during the transition,
-- while new code and UI can move to:
--   - devices.nav
--   - device_models.lookup / manage / task_lookup
--   - spare_parts.lookup / manage / task_lookup
--   - devices.discounts.view / manage
--   - devices.department_availability.view / manage
-- ============================================================

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('devices.nav', 'devices', 'navigation', 'nav',
   'إظهار قسم الأجهزة وقطع الغيار', 205, ARRAY['GLOBAL','BRANCH']),
  ('device_models.lookup', 'devices', 'device_models', 'lookup',
   'قراءة تعريفات الأجهزة', 206, ARRAY['GLOBAL']),
  ('spare_parts.lookup', 'devices', 'spare_parts', 'lookup',
   'قراءة تعريفات قطع الغيار', 207, ARRAY['GLOBAL']),
  ('device_models.manage', 'devices', 'device_models', 'manage',
   'إدارة تعريفات الأجهزة', 210, ARRAY['GLOBAL']),
  ('spare_parts.manage', 'devices', 'spare_parts', 'manage',
   'إدارة تعريفات قطع الغيار', 211, ARRAY['GLOBAL']),
  ('devices.discounts.view', 'devices', 'discounts', 'view',
   'عرض خصومات الأجهزة', 212, ARRAY['GLOBAL']),
  ('devices.discounts.manage', 'devices', 'discounts', 'manage',
   'إدارة خصومات الأجهزة', 213, ARRAY['GLOBAL']),
  ('devices.department_availability.view', 'devices', 'department_availability', 'view',
   'عرض الأجهزة المخصصة للأقسام', 214, ARRAY['GLOBAL','BRANCH']),
  ('devices.department_availability.manage', 'devices', 'department_availability', 'manage',
   'إدارة أجهزة الأقسام', 215, ARRAY['GLOBAL','BRANCH']),
  ('device_models.task_lookup', 'devices', 'device_models', 'task_lookup',
   'قراءة الأجهزة المسموحة داخل العمليات', 216, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('spare_parts.task_lookup', 'devices', 'spare_parts', 'task_lookup',
   'قراءة قطع الغيار المسموحة داخل العمليات', 217, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('installed_devices.view', 'devices', 'installed_devices', 'view',
   'عرض الأجهزة المركبة', 218, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('installed_devices.update_service_data', 'devices', 'installed_devices', 'update_service_data',
   'تعديل بيانات خدمة الجهاز المركب', 219, ARRAY['GLOBAL','BRANCH']),
  ('installed_devices.possession.view', 'devices', 'installed_device_possession', 'view',
   'عرض سجل حيازة الجهاز', 220, ARRAY['GLOBAL','BRANCH']),
  ('installed_devices.possession.manage', 'devices', 'installed_device_possession', 'manage',
   'إدارة حيازة الجهاز', 221, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

-- Migrate broad device definition management from the legacy permission.
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
    WHERE p.key = 'catalog.manage'
  ) grants
  GROUP BY role_id
),
target_permissions AS (
  SELECT id AS permission_id
  FROM public.permissions
  WHERE key IN (
    'devices.nav',
    'device_models.lookup',
    'spare_parts.lookup',
    'device_models.manage',
    'spare_parts.manage',
    'devices.discounts.view'
  )
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.permission_id, sg.scope_type
FROM source_grants sg
CROSS JOIN target_permissions tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

-- Existing discount managers also get discount view and the section entry.
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
    WHERE p.key = 'devices.discounts.manage'
  ) grants
  GROUP BY role_id
),
target_permissions AS (
  SELECT id AS permission_id
  FROM public.permissions
  WHERE key IN ('devices.nav', 'devices.discounts.view')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.permission_id, sg.scope_type
FROM source_grants sg
CROSS JOIN target_permissions tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

-- Department managers can manage device availability inside their branch.
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
    WHERE p.key = 'departments.manage'
  ) grants
  GROUP BY role_id
),
target_permissions AS (
  SELECT id AS permission_id
  FROM public.permissions
  WHERE key IN (
    'devices.department_availability.view',
    'devices.department_availability.manage'
  )
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.permission_id, sg.scope_type
FROM source_grants sg
CROSS JOIN target_permissions tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

-- Routine workflows that already have reference lookup can read device/part
-- values inside operation forms without receiving the admin section.
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
    WHERE p.key = 'reference_data.lookup'
  ) grants
  GROUP BY role_id
),
target_permissions AS (
  SELECT id AS permission_id
  FROM public.permissions
  WHERE key IN ('device_models.task_lookup', 'spare_parts.task_lookup')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.permission_id, sg.scope_type
FROM source_grants sg
CROSS JOIN target_permissions tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

-- Installed-device viewing currently exists through client profile device
-- permissions and contract viewing. Seed the explicit key from those grants.
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
    WHERE p.key IN ('clients.devices.view', 'contracts.view_list')
  ) grants
  GROUP BY role_id
),
target_permissions AS (
  SELECT id AS permission_id
  FROM public.permissions
  WHERE key IN ('installed_devices.view', 'installed_devices.possession.view')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.permission_id, sg.scope_type
FROM source_grants sg
CROSS JOIN target_permissions tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

-- Installed-device service data updates are currently guarded by contract edit.
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
    WHERE p.key = 'contracts.edit'
  ) grants
  GROUP BY role_id
),
target_permissions AS (
  SELECT id AS permission_id
  FROM public.permissions
  WHERE key IN ('installed_devices.update_service_data', 'installed_devices.possession.manage')
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.permission_id, sg.scope_type
FROM source_grants sg
CROSS JOIN target_permissions tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

COMMIT;
