-- 173_branches_edit_permission.sql
-- Adds branches.edit permission: allows editing name/address/contactInfo
-- without granting branches.manage (create, delete, status, coverage changes).
BEGIN;

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'branches.edit',
  'branches',
  'management',
  'edit',
  'تعديل بيانات الفرع',
  11,
  ARRAY['GLOBAL', 'BRANCH']
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
