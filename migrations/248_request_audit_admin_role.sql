-- ============================================================
-- 248_request_audit_admin_role.sql
-- ============================================================
-- Phase 1.2 — Create the request_audit_admin template role and
-- wire baseline grants for the service_requests permissions.
--
-- Per maintenance.md §٠.١٦ (نموذج الصلاحية الثنائي):
--
--   request_audit_admin owns:
--     - service_requests.view     (GLOBAL)
--     - service_requests.reject   (GLOBAL) — exclusive authority
--     - service_requests.archive  (GLOBAL)
--
--   SYSTEM_ADMIN (existing) gains ALL 6 service_requests perms
--   so super-admins can fully manage the intake layer.
--
--   Admin Operator and branch_manager roles are NOT seeded here —
--   they will be granted via the /roles admin UI in staging.
--   This keeps the migration boundary clean and lets ops choose
--   which existing role plays the Operator persona.
--
-- Role design:
--   - is_template = true (template-level, no branch)
--   - is_system   = false (admins can edit, unlike SYSTEM_ADMIN)
--   - is_protected = false
--   - branch_id   = NULL (template roles must have no branch per roles_scope_ck)
--
-- Idempotent — relies on roles.name uniqueness + ON CONFLICT on
-- role_permission_grants natural key. If role.name isn't unique
-- in DB constraint, we add a partial unique index for template roles.
--
-- Reference: docs/constitution/features/tasks/maintenance.md §٠.١٦
-- ============================================================

BEGIN;

-- Ensure template role names are unique so the upsert below is safe.
-- (Live roles can share names across branches; templates cannot.)
CREATE UNIQUE INDEX IF NOT EXISTS roles_template_name_unique
  ON public.roles (name)
  WHERE is_template = true;

-- 1) Create the request_audit_admin template role.
INSERT INTO public.roles
  (name, display_name, description, is_system, is_active, is_template, is_protected, is_hidden, branch_id)
VALUES
  ('REQUEST_AUDIT_ADMIN',
   'مدقّق طلبات الصيانة',
   'الدور المسؤول عن رفض طلبات الصيانة وتدقيقها مركزياً. صلاحياته GLOBAL حصراً (٠.١٦).',
   false, true, true, false, false, NULL)
ON CONFLICT (name) WHERE is_template = true DO NOTHING;

-- 2) Ensure role_permission_grants natural key is unique for safe upserts.
CREATE UNIQUE INDEX IF NOT EXISTS role_permission_grants_natural_unique
  ON public.role_permission_grants (role_id, permission_id, scope_type);

-- 3) Grant the 3 audit-admin perms to REQUEST_AUDIT_ADMIN.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM public.roles r
  JOIN public.permissions p ON p.key IN (
    'service_requests.view',
    'service_requests.reject',
    'service_requests.archive'
  )
 WHERE r.name = 'REQUEST_AUDIT_ADMIN' AND r.is_template = true
ON CONFLICT (role_id, permission_id, scope_type) DO NOTHING;

-- 4) Grant all 6 service_requests perms to SYSTEM_ADMIN (super-admin).
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM public.roles r
  JOIN public.permissions p ON p.key LIKE 'service_requests.%'
 WHERE r.name = 'SYSTEM_ADMIN' AND r.is_template = true
ON CONFLICT (role_id, permission_id, scope_type) DO NOTHING;

COMMENT ON INDEX public.roles_template_name_unique IS
  'Template role names are unique (live branch roles can share names).';

COMMIT;
