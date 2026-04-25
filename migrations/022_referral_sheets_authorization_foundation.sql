-- ============================================================
-- Migration 022: Referral sheets authorization foundation
-- - Adds branch_id as the canonical branch source for referral_sheets
-- - Backfills conservatively from the owner's active primary assignment
-- - Adds the canonical referral_sheets permission keys
-- ============================================================

ALTER TABLE referral_sheets
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;

WITH owner_primary_branch AS (
  SELECT DISTINCT ON (uba.user_id)
         uba.user_id,
         uba.branch_id
    FROM user_branch_assignments uba
   WHERE uba.status = 'active'
   ORDER BY uba.user_id, uba.is_primary DESC, uba.created_at ASC, uba.id ASC
),
owner_legacy_branch AS (
  SELECT u.id AS user_id, u.branch_id
    FROM hr_users u
   WHERE u.branch_id IS NOT NULL
)
UPDATE referral_sheets rs
   SET branch_id = COALESCE(opb.branch_id, olb.branch_id)
  FROM owner_primary_branch opb
  FULL OUTER JOIN owner_legacy_branch olb
    ON olb.user_id = opb.user_id
 WHERE rs.branch_id IS NULL
   AND rs.owner_user_id = COALESCE(opb.user_id, olb.user_id);

CREATE INDEX IF NOT EXISTS idx_referral_sheets_branch
  ON referral_sheets(branch_id);

-- PHASE3C_LEGACY_FALLBACK: existing rows are backfilled from the owner's
-- primary active branch assignment when available, otherwise from hr_users.branch_id.
-- New runtime writes should set referral_sheets.branch_id explicitly.

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('referral_sheets.view_list', 'referral_sheets', 'referral_sheets', 'view_list', 'عرض أوراق الإحالة', 10),
  ('referral_sheets.create', 'referral_sheets', 'referral_sheets', 'create', 'إنشاء ورقة إحالة', 20),
  ('referral_sheets.edit', 'referral_sheets', 'referral_sheets', 'edit', 'تعديل ورقة إحالة', 30),
  ('referral_sheets.delete', 'referral_sheets', 'referral_sheets', 'delete', 'حذف ورقة إحالة', 40)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.key IN (
      'referral_sheets.view_list',
      'referral_sheets.create',
      'referral_sheets.edit',
      'referral_sheets.delete'
    )
 WHERE r.is_template = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p
    ON p.key IN (
      'referral_sheets.view_list',
      'referral_sheets.create',
      'referral_sheets.edit',
      'referral_sheets.delete'
    )
 WHERE r.is_template = TRUE
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();
