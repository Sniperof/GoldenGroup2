-- External customer devices are real installed_devices that are not born from a
-- company sale contract. They can receive service requests and tasks, but they
-- have no contract warranty or contract ledger.

ALTER TABLE public.installed_devices
  ALTER COLUMN contract_id DROP NOT NULL;

ALTER TABLE public.installed_devices
  ADD COLUMN IF NOT EXISTS device_source varchar(32) NOT NULL DEFAULT 'company_contract',
  ADD COLUMN IF NOT EXISTS external_device_name varchar(255),
  ADD COLUMN IF NOT EXISTS external_device_serial varchar(255),
  ADD COLUMN IF NOT EXISTS external_device_notes text;

ALTER TABLE public.installed_devices
  DROP CONSTRAINT IF EXISTS installed_devices_device_source_ck;

ALTER TABLE public.installed_devices
  ADD CONSTRAINT installed_devices_device_source_ck
  CHECK (device_source IN ('company_contract', 'external'));

UPDATE public.installed_devices
SET device_source = CASE WHEN contract_id IS NULL THEN 'external' ELSE 'company_contract' END
WHERE device_source IS NULL
   OR (contract_id IS NULL AND device_source <> 'external')
   OR (contract_id IS NOT NULL AND device_source <> 'company_contract');

DROP INDEX IF EXISTS public.uidx_installed_devices_contract;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_installed_devices_contract
  ON public.installed_devices(contract_id)
  WHERE contract_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_installed_devices_device_source
  ON public.installed_devices(device_source);

CREATE INDEX IF NOT EXISTS idx_installed_devices_external_serial
  ON public.installed_devices(external_device_serial)
  WHERE external_device_serial IS NOT NULL;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('installed_devices.create_external', 'devices', 'installed_devices', 'create_external',
   'إنشاء جهاز خارجي للزبون بدون عقد بيع من الشركة', 225, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

WITH source_grants AS (
  SELECT
    role_id,
    CASE
      WHEN BOOL_OR(scope_type = 'GLOBAL') THEN 'GLOBAL'
      ELSE 'BRANCH'
    END::varchar AS scope_type
  FROM (
    SELECT rpg.role_id, rpg.scope_type
    FROM public.role_permission_grants rpg
    JOIN public.permissions p ON p.id = rpg.permission_id
    WHERE p.key IN ('installed_devices.update_service_data', 'contracts.edit')
      AND rpg.scope_type IN ('GLOBAL', 'BRANCH')
  ) grants
  GROUP BY role_id
),
target_permission AS (
  SELECT id AS permission_id
  FROM public.permissions
  WHERE key = 'installed_devices.create_external'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.permission_id, sg.scope_type
FROM source_grants sg
CROSS JOIN target_permission tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();
