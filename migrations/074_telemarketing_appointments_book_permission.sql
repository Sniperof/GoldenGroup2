-- Migration 074: Add telemarketing.appointments.book as an independent permission.
-- The existing telemarketing.appointments.create is kept for backward compatibility.
-- Assigned to the same roles that already hold telemarketing.appointments.create.

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'telemarketing.appointments.book',
  'telemarketing',
  'appointments',
  'book',
  'حجز موعد زيارة تسويقية (تيلماركتر)',
  165,
  '{GLOBAL,BRANCH}'
)
ON CONFLICT (key) DO NOTHING;

-- Assign to all roles that already have telemarketing.appointments.create
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p_new.id
FROM role_permissions rp
JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.key = 'telemarketing.appointments.create'
CROSS JOIN (SELECT id FROM permissions WHERE key = 'telemarketing.appointments.book') p_new
ON CONFLICT DO NOTHING;
