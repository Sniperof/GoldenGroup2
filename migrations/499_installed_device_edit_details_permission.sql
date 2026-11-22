-- 499: Own permission to edit an installed device's details (2026-11-19)
--
-- The device page could not correct a device's data: the only write path,
-- PATCH /installed-devices/:id, sits on contracts.edit and accepts any field
-- (status included). Decisions:
--   D1  new installed_devices.edit_details (GLOBAL / BRANCH): the one key for
--       the edits made from the device page. First edit: the serial number
--       (PATCH /installed-devices/:id/details); further device-page edits
--       join this key.
--   D2  a new power, not a split of an existing one: granted to nobody here;
--       the administrator assigns it from the roles screen.
--   D3  every edit carries a reason, kept in the device activity log (498).

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('installed_devices.edit_details', 'devices', 'installed_devices', 'edit_details',
   'تعديل بيانات الجهاز المركب من صفحة الجهاز', 224, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

COMMIT;
