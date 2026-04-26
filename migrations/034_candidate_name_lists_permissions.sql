-- ============================================================
-- Migration 034: Candidate name-list permissions
-- - Adds explicit candidates.name_lists.* keys for referral/name lists
-- - Copies existing referral_sheets.* grants to the new candidates module
-- - Keeps legacy referral_sheets.* permissions in place for compatibility
-- ============================================================

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('candidates.name_lists.view_list', 'candidates', 'name_lists', 'view_list', 'عرض لوائح الأسماء', 50),
  ('candidates.name_lists.create', 'candidates', 'name_lists', 'create', 'إنشاء لائحة أسماء', 60),
  ('candidates.name_lists.edit', 'candidates', 'name_lists', 'edit', 'تعديل لائحة أسماء', 70),
  ('candidates.name_lists.delete', 'candidates', 'name_lists', 'delete', 'حذف لائحة أسماء', 80)
ON CONFLICT (key) DO NOTHING;

WITH permission_map AS (
  SELECT *
    FROM (VALUES
      ('referral_sheets.view_list', 'candidates.name_lists.view_list'),
      ('referral_sheets.create', 'candidates.name_lists.create'),
      ('referral_sheets.edit', 'candidates.name_lists.edit'),
      ('referral_sheets.delete', 'candidates.name_lists.delete')
    ) AS m(old_key, new_key)
),
legacy_grants AS (
  SELECT rpg.role_id, new_perm.id AS new_permission_id, rpg.scope_type
    FROM role_permission_grants rpg
    JOIN permissions old_perm ON old_perm.id = rpg.permission_id
    JOIN permission_map pm ON pm.old_key = old_perm.key
    JOIN permissions new_perm ON new_perm.key = pm.new_key
)
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT role_id, new_permission_id, scope_type
  FROM legacy_grants
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

WITH permission_map AS (
  SELECT *
    FROM (VALUES
      ('referral_sheets.view_list', 'candidates.name_lists.view_list'),
      ('referral_sheets.create', 'candidates.name_lists.create'),
      ('referral_sheets.edit', 'candidates.name_lists.edit'),
      ('referral_sheets.delete', 'candidates.name_lists.delete')
    ) AS m(old_key, new_key)
),
legacy_permissions AS (
  SELECT rp.role_id, new_perm.id AS new_permission_id
    FROM role_permissions rp
    JOIN permissions old_perm ON old_perm.id = rp.permission_id
    JOIN permission_map pm ON pm.old_key = old_perm.key
    JOIN permissions new_perm ON new_perm.key = pm.new_key
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT role_id, new_permission_id
  FROM legacy_permissions
ON CONFLICT (role_id, permission_id) DO NOTHING;
