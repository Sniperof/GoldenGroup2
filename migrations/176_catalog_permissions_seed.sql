-- 176_catalog_permissions_seed.sql
-- Seeds catalog.manage and devices.discounts.manage permissions
-- to complete GAP-050 (public catalog access) and GAP-051 (discount management).
-- Grants both to SYSTEM_ADMIN with GLOBAL scope.
BEGIN;

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('catalog.manage',            'catalog', 'devices',   'manage', 'إدارة كتالوج الأجهزة وقطع الغيار', 210, ARRAY['GLOBAL']),
  ('devices.discounts.manage',  'catalog', 'discounts', 'manage', 'إدارة حملات خصومات الأجهزة',        211, ARRAY['GLOBAL'])
ON CONFLICT (key) DO NOTHING;

-- Grant to SYSTEM_ADMIN template role
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
FROM roles r
JOIN permissions p ON p.key IN ('catalog.manage', 'devices.discounts.manage')
WHERE r.name = 'SYSTEM_ADMIN'
  AND r.is_template = TRUE
  AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
