-- ============================================================
-- Migration 021: Candidates authorization enablement
-- - Adds the canonical candidates permission keys
-- - Grants them conservatively to template roles with BRANCH scope
-- ============================================================

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('candidates.view_list', 'candidates', 'candidates', 'view_list', 'عرض المرشحين', 10),
  ('candidates.create', 'candidates', 'candidates', 'create', 'إنشاء مرشح', 20),
  ('candidates.edit', 'candidates', 'candidates', 'edit', 'تعديل مرشح', 30),
  ('candidates.delete', 'candidates', 'candidates', 'delete', 'حذف مرشح', 40)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.key IN (
      'candidates.view_list',
      'candidates.create',
      'candidates.edit',
      'candidates.delete'
    )
 WHERE r.is_template = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p
    ON p.key IN (
      'candidates.view_list',
      'candidates.create',
      'candidates.edit',
      'candidates.delete'
    )
 WHERE r.is_template = TRUE
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();
