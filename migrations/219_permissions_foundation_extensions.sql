-- ============================================================
-- Migration 219: Foundation permission keys for visit reopen + cooldown unlock
-- ============================================================
-- Constitution source:
--   DEC-004 D11 — field_visits.reopen_closed (إدارة عليا فقط + سبب مكتوب)
--   DEC-006 D32 — clients.cooldown_unlock (مدير الفرع حصراً)
--
-- Pattern reference: migration 119 (resolve_escalation_permission)
--
-- Notes:
--   - Permission key naming follows project convention {module}.{action}
--   - clients.cooldown_unlock chosen because cooldown_until lives on `clients`
--     table; the action operates on a client field. DEC-006 D32 informally
--     called it "permissions.cooldown_unlock" — the `permissions.` prefix in
--     the doc was descriptive, not the actual module name.
--   - Grants target template roles (branch_id IS NULL, is_template = TRUE);
--     migration 015's clone_role_templates_to_branch function propagates to
--     existing branches automatically when called.
-- ============================================================

-- ---------- field_visits.reopen_closed ----------
INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'field_visits.reopen_closed',
  'field_visits',
  'field_visits',
  'reopen_closed',
  'فتح زيارة مُقفلة',
  90,
  ARRAY['GLOBAL']
)
ON CONFLICT (key) DO UPDATE
  SET module        = EXCLUDED.module,
      sub_module    = EXCLUDED.sub_module,
      action        = EXCLUDED.action,
      display_name  = EXCLUDED.display_name,
      display_order = EXCLUDED.display_order,
      allowed_scopes = EXCLUDED.allowed_scopes;

-- Grant to SYSTEM_ADMIN only (DEC-004 D11: إدارة عليا فقط)
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p ON p.key = 'field_visits.reopen_closed'
 WHERE r.name        = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

-- ---------- clients.cooldown_unlock ----------
INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'clients.cooldown_unlock',
  'clients',
  'clients',
  'cooldown_unlock',
  'فك فترة التهدئة (cooldown) للزبون',
  85,
  ARRAY['GLOBAL', 'BRANCH']
)
ON CONFLICT (key) DO UPDATE
  SET module        = EXCLUDED.module,
      sub_module    = EXCLUDED.sub_module,
      action        = EXCLUDED.action,
      display_name  = EXCLUDED.display_name,
      display_order = EXCLUDED.display_order,
      allowed_scopes = EXCLUDED.allowed_scopes;

-- Grant to SYSTEM_ADMIN (GLOBAL)
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p ON p.key = 'clients.cooldown_unlock'
 WHERE r.name        = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();

-- Grant to branch_manager (BRANCH) — DEC-006 D32 explicit assignment
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key = 'clients.cooldown_unlock'
 WHERE r.name        = 'branch_manager'
   AND r.is_template = TRUE
   AND r.branch_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();
