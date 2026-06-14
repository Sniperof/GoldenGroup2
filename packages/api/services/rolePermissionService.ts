import type { ScopeType } from '@golden-crm/shared';
import pool from '../db.js';
import { clearAuthorizationCache } from './authorizationService.js';

const VALID_SCOPE_TYPES = new Set<ScopeType>(['GLOBAL', 'BRANCH', 'ASSIGNED']);

export interface RolePermissionGrantInput {
  permissionId: number;
  scopeType: ScopeType;
}

export interface PermissionCatalogRow {
  id: number;
  key: string;
  module: string;
  sub_module: string;
  action: string;
  display_name: string;
  display_order: number;
  allowed_scopes: ScopeType[];
}

export interface RolePermissionGrantRow extends PermissionCatalogRow {
  scope_type: ScopeType;
}

export type RolePermissionServiceErrorCode =
  | 'ROLE_NOT_FOUND'
  | 'ROLE_PROTECTED'
  | 'INVALID_GRANTS'
  | 'PERMISSION_NOT_FOUND'
  | 'SCOPE_NOT_ALLOWED';

export class RolePermissionServiceError extends Error {
  constructor(
    public readonly code: RolePermissionServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RolePermissionServiceError';
  }
}

export async function listPermissionCatalog(): Promise<PermissionCatalogRow[]> {
  const { rows } = await pool.query(
    'SELECT * FROM permissions ORDER BY display_order',
  );
  return rows.map(normalizePermissionRow);
}

export async function listRolePermissionGrants(roleId: number): Promise<RolePermissionGrantRow[]> {
  await requireRole(roleId);

  const { rows } = await pool.query(
    `SELECT p.*, rpg.scope_type
       FROM role_permission_grants rpg
       JOIN permissions p ON p.id = rpg.permission_id
      WHERE rpg.role_id = $1
      ORDER BY p.display_order`,
    [roleId],
  );

  return rows.map(normalizeGrantRow);
}

export async function replaceRolePermissionGrants(
  roleId: number,
  grants: RolePermissionGrantInput[],
): Promise<RolePermissionGrantRow[]> {
  const deduplicatedGrants = normalizeGrantInputs(grants);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: roleRows } = await client.query(
      `SELECT id, is_system, is_protected, protected_reason
         FROM roles
        WHERE id = $1
        FOR UPDATE`,
      [roleId],
    );
    const role = roleRows[0];
    if (!role) {
      throw new RolePermissionServiceError('ROLE_NOT_FOUND', 'الدور غير موجود');
    }
    if (role.is_system || role.is_protected) {
      const reason = typeof role.protected_reason === 'string' ? role.protected_reason.trim() : '';
      throw new RolePermissionServiceError(
        'ROLE_PROTECTED',
        reason
          ? `لا يمكن تعديل صلاحيات هذا الدور المحمي: ${reason}`
          : 'لا يمكن تعديل صلاحيات هذا الدور المحمي',
      );
    }

    if (deduplicatedGrants.length > 0) {
      const permissionIds = deduplicatedGrants.map(grant => grant.permissionId);
      const { rows: permissionRows } = await client.query(
        'SELECT id, allowed_scopes FROM permissions WHERE id = ANY($1)',
        [permissionIds],
      );
      const allowedScopesByPermission = new Map<number, ScopeType[]>(
        permissionRows.map(row => [
          Number(row.id),
          normalizeAllowedScopes(row.allowed_scopes),
        ]),
      );

      for (const grant of deduplicatedGrants) {
        const allowedScopes = allowedScopesByPermission.get(grant.permissionId);
        if (!allowedScopes) {
          throw new RolePermissionServiceError(
            'PERMISSION_NOT_FOUND',
            `الصلاحية رقم ${grant.permissionId} غير موجودة`,
          );
        }
        if (!allowedScopes.includes(grant.scopeType)) {
          throw new RolePermissionServiceError(
            'SCOPE_NOT_ALLOWED',
            `النطاق "${grant.scopeType}" غير مسموح لهذه الصلاحية. النطاقات المسموحة: ${allowedScopes.join(', ')}`,
          );
        }
      }
    }

    await client.query(
      'DELETE FROM role_permission_grants WHERE role_id = $1',
      [roleId],
    );

    if (deduplicatedGrants.length > 0) {
      const values = deduplicatedGrants
        .map((_, index) => `($1, $${index * 2 + 2}, $${index * 2 + 3})`)
        .join(', ');
      await client.query(
        `INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
         VALUES ${values}`,
        [roleId, ...deduplicatedGrants.flatMap(grant => [grant.permissionId, grant.scopeType])],
      );
    }

    const { rows } = await client.query(
      `SELECT p.*, rpg.scope_type
         FROM role_permission_grants rpg
         JOIN permissions p ON p.id = rpg.permission_id
        WHERE rpg.role_id = $1
        ORDER BY p.display_order`,
      [roleId],
    );

    await client.query('COMMIT');
    clearAuthorizationCache();
    return rows.map(normalizeGrantRow);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function normalizeGrantInputs(grants: RolePermissionGrantInput[]): RolePermissionGrantInput[] {
  if (!Array.isArray(grants)) {
    throw new RolePermissionServiceError('INVALID_GRANTS', 'قائمة الصلاحيات مطلوبة');
  }

  const deduplicated = new Map<number, RolePermissionGrantInput>();
  for (const grant of grants) {
    if (
      !Number.isInteger(grant.permissionId) ||
      grant.permissionId <= 0 ||
      !VALID_SCOPE_TYPES.has(grant.scopeType)
    ) {
      throw new RolePermissionServiceError(
        'INVALID_GRANTS',
        'صلاحيات أو نطاقات غير صالحة',
      );
    }
    deduplicated.set(grant.permissionId, grant);
  }
  return Array.from(deduplicated.values());
}

async function requireRole(roleId: number): Promise<void> {
  if (!Number.isInteger(roleId) || roleId <= 0) {
    throw new RolePermissionServiceError('ROLE_NOT_FOUND', 'الدور غير موجود');
  }

  const { rows } = await pool.query('SELECT id FROM roles WHERE id = $1', [roleId]);
  if (!rows[0]) {
    throw new RolePermissionServiceError('ROLE_NOT_FOUND', 'الدور غير موجود');
  }
}

function normalizePermissionRow(row: Record<string, unknown>): PermissionCatalogRow {
  return {
    id: Number(row.id),
    key: String(row.key),
    module: String(row.module),
    sub_module: String(row.sub_module),
    action: String(row.action),
    display_name: String(row.display_name),
    display_order: Number(row.display_order),
    allowed_scopes: normalizeAllowedScopes(row.allowed_scopes),
  };
}

function normalizeGrantRow(row: Record<string, unknown>): RolePermissionGrantRow {
  const permission = normalizePermissionRow(row);
  const scopeType = normalizeScope(row.scope_type);
  if (!scopeType) {
    throw new RolePermissionServiceError(
      'INVALID_GRANTS',
      `النطاق المخزن للصلاحية "${permission.key}" غير صالح`,
    );
  }

  return {
    ...permission,
    scope_type: scopeType,
  };
}

function normalizeAllowedScopes(value: unknown): ScopeType[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeScope)
    .filter((scope): scope is ScopeType => scope != null);
}

function normalizeScope(value: unknown): ScopeType | null {
  return typeof value === 'string' && VALID_SCOPE_TYPES.has(value as ScopeType)
    ? value as ScopeType
    : null;
}
