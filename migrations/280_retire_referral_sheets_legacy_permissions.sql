-- ============================================================
-- 280_retire_referral_sheets_legacy_permissions.sql
-- ============================================================
-- Retire the legacy `referral_sheets.*` permission family. It duplicated the
-- canonical `candidates.name_lists.*` keys but at {GLOBAL,BRANCH} only (no
-- ASSIGNED). Because the policy/routes accepted EITHER via OR semantics, a role
-- holding both families got the broader scope — silently nullifying the intended
-- ASSIGNED (own-records-only) scoping (e.g. a supervisor saw the whole branch's
-- name lists instead of her own). Code now references only the canonical family.
--
-- Idempotent / safe to re-run.
-- ============================================================

BEGIN;

-- Drop grants first (FK), then the catalog rows.
DELETE FROM role_permission_grants rpg
USING permissions p
WHERE rpg.permission_id = p.id
  AND p.key LIKE 'referral_sheets.%';

DELETE FROM permissions
WHERE key LIKE 'referral_sheets.%';

COMMIT;
