import type {
  AuthContext,
  AuthUser,
  AuthorizationCheck,
  AuthorizationResult,
  PermissionGrant,
  ScopeType,
} from '@golden-crm/shared';
import pool from '../db.js';

export interface BuildAuthContextInput {
  user: Pick<AuthUser, 'id' | 'roleId' | 'isSuperAdmin' | 'branchId'>;
  headerBranchId?: number | string | null;
}

interface LoadedAuthorizationData {
  grants: PermissionGrant[];
  allowedBranchIds: number[];
  primaryBranchId: number | null;
  loadedAt: number;
  cacheRoleId: number | null;
  cacheBranchId: number | null;
}

const cache = new Map<number, LoadedAuthorizationData>();

// Temporary hardening: TTL is intentionally short (60 s) because this is an
// in-memory per-process cache with no cross-process invalidation.
// For multi-instance production, replace with distributed cache invalidation
// (e.g. Redis pub/sub keyed on user id) and this constant can be raised again.
const AUTHORIZATION_CACHE_TTL_MS = 60_000;

export async function buildAuthContext(input: BuildAuthContextInput): Promise<AuthContext> {
  const userId = input.user.id;
  const roleId = input.user.roleId ?? null;
  const isSuperAdmin = input.user.isSuperAdmin === true;
  const loaded = await loadAuthorizationData(input.user);

  return {
    userId,
    roleId,
    isSuperAdmin,
    grants: loaded.grants,
    allowedBranchIds: loaded.allowedBranchIds,
    actingBranchId: resolveActingBranch({
      headerBranchId: input.headerBranchId,
      primaryBranchId: loaded.primaryBranchId,
      allowedBranchIds: loaded.allowedBranchIds,
      isSuperAdmin,
    }),
  };
}

export function clearAuthorizationCache(userId?: number) {
  if (userId != null) {
    cache.delete(userId);
    return;
  }

  cache.clear();
}

export function resolveActingBranch(
  options: {
    headerBranchId?: number | string | null;
    primaryBranchId?: number | null;
    isSuperAdmin?: boolean;
    allowedBranchIds?: number[];
  },
): number | null {
  const requestedBranchId = toPositiveInteger(options.headerBranchId);
  const primaryBranchId = toPositiveInteger(options.primaryBranchId);
  const allowedBranchIds = normalizeBranchIds(options.allowedBranchIds);

  if (requestedBranchId == null) {
    return primaryBranchId;
  }

  if (options.isSuperAdmin === true) {
    if (allowedBranchIds.length === 0 || allowedBranchIds.includes(requestedBranchId)) {
      return requestedBranchId;
    }
    return null;
  }

  if (!allowedBranchIds.includes(requestedBranchId)) {
    return null;
  }

  return requestedBranchId;
}

export function authorize(context: AuthContext, check: AuthorizationCheck): AuthorizationResult {
  if (context.isSuperAdmin) {
    return { allowed: true, reason: 'SUPER_ADMIN' };
  }

  const grant = context.grants.find(item => item.permission === check.permission);
  if (!grant) {
    return { allowed: false, reason: 'MISSING_PERMISSION' };
  }

  // GLOBAL comes only from explicit grants on the role/permission pair.
  // Missing branch assignments must never be interpreted as GLOBAL access.
  switch (grant.scope) {
    case 'GLOBAL':
      return { allowed: true, reason: 'GRANTED_GLOBAL', grant };
    case 'BRANCH':
      return authorizeBranchGrant(context, check, grant);
    case 'ASSIGNED':
      return authorizeAssignedGrant(context, check, grant);
    default:
      return { allowed: false, reason: 'MISSING_PERMISSION' };
  }
}

async function loadAuthorizationData(
  user: Pick<AuthUser, 'id' | 'roleId' | 'branchId'>,
): Promise<LoadedAuthorizationData> {
  const roleId = user.roleId ?? null;
  const legacyBranchId = toPositiveInteger(user.branchId);
  const cached = cache.get(user.id);
  if (
    cached &&
    Date.now() - cached.loadedAt < AUTHORIZATION_CACHE_TTL_MS &&
    cached.cacheRoleId === roleId &&
    cached.cacheBranchId === legacyBranchId
  ) {
    return cached;
  }

  const [grantsRows, assignmentRows] = await Promise.all([
    loadRolePermissionGrants(roleId),
    loadUserBranchAssignments(user.id),
  ]);

  const allowedBranchIds = normalizeBranchIds(assignmentRows.map(row => row.branchId));
  const primaryBranchId = resolvePrimaryBranchId(assignmentRows, legacyBranchId);

  const loaded: LoadedAuthorizationData = {
    grants: grantsRows,
    allowedBranchIds,
    primaryBranchId,
    loadedAt: Date.now(),
    cacheRoleId: roleId,
    cacheBranchId: legacyBranchId,
  };

  cache.set(user.id, loaded);
  return loaded;
}

async function loadRolePermissionGrants(roleId: number | null): Promise<PermissionGrant[]> {
  if (roleId == null) {
    return [];
  }

  const { rows } = await pool.query(
    `SELECT p.key AS permission, rpg.scope_type AS scope
       FROM role_permission_grants rpg
       JOIN permissions p ON p.id = rpg.permission_id
      WHERE rpg.role_id = $1`,
    [roleId],
  );

  return rows
    .map(row => {
      const scope = normalizeScope(row.scope);
      if (!scope || typeof row.permission !== 'string') {
        return null;
      }

      return {
        permission: row.permission,
        scope,
      } satisfies PermissionGrant;
    })
    .filter((grant): grant is PermissionGrant => grant != null);
}

async function loadUserBranchAssignments(
  userId: number,
): Promise<Array<{ branchId: number; isPrimary: boolean }>> {
  const { rows } = await pool.query(
    `SELECT branch_id AS "branchId", is_primary AS "isPrimary"
       FROM user_branch_assignments
      WHERE user_id = $1
        AND status = 'active'
      ORDER BY is_primary DESC, created_at ASC, id ASC`,
    [userId],
  );

  return rows
    .map(row => {
      const branchId = toPositiveInteger(row.branchId);
      if (branchId == null) {
        return null;
      }

      return {
        branchId,
        isPrimary: row.isPrimary === true,
      };
    })
    .filter((row): row is { branchId: number; isPrimary: boolean } => row != null);
}

function resolvePrimaryBranchId(
  assignments: Array<{ branchId: number; isPrimary: boolean }>,
  legacyBranchId: number | null,
): number | null {
  const explicitPrimary = assignments.find(assignment => assignment.isPrimary);
  if (explicitPrimary) {
    return explicitPrimary.branchId;
  }

  if (assignments.length > 0) {
    return assignments[0].branchId;
  }

  // PHASE2B_LEGACY_FALLBACK
  // TEMP: fall back to hr_users.branch_id only when the user has no active
  // branch assignments yet, to avoid changing runtime behavior abruptly.
  return legacyBranchId;
}

function authorizeBranchGrant(
  context: AuthContext,
  check: AuthorizationCheck,
  grant: PermissionGrant,
): AuthorizationResult {
  const targetBranchId = toPositiveInteger(check.branchId);
  const actingBranchId = toPositiveInteger(context.actingBranchId);

  if (targetBranchId == null && actingBranchId == null) {
    return { allowed: false, reason: 'MISSING_BRANCH_CONTEXT', grant };
  }

  const effectiveBranchId = targetBranchId ?? actingBranchId;
  if (effectiveBranchId != null && context.allowedBranchIds.includes(effectiveBranchId)) {
    return { allowed: true, reason: 'GRANTED_BRANCH', grant };
  }

  return { allowed: false, reason: 'BRANCH_FORBIDDEN', grant };
}

function authorizeAssignedGrant(
  context: AuthContext,
  check: AuthorizationCheck,
  grant: PermissionGrant,
): AuthorizationResult {
  // Distinguish between three cases for assignedUserId:
  //   undefined → no subject provided (middleware / list-level check) → treat as self-check
  //   null      → record is explicitly unassigned → ASSIGNMENT_FORBIDDEN for ASSIGNED-scope users
  //   number    → specific user → must match context.userId
  //
  // This allows requirePermission('clients.view_list') to pass for ASSIGNED-scope users
  // without requiring a specific record subject (the middleware has no record to check against).
  const assignedUserId = check.assignedUserId === undefined
    ? context.userId                           // self-check: user is checking their own access
    : toPositiveInteger(check.assignedUserId); // explicit null → null; number → that user

  if (assignedUserId == null || assignedUserId !== context.userId) {
    return { allowed: false, reason: 'ASSIGNMENT_FORBIDDEN', grant };
  }

  const targetBranchId = toPositiveInteger(check.branchId);
  const actingBranchId = toPositiveInteger(context.actingBranchId);
  const effectiveBranchId = targetBranchId ?? actingBranchId;

  if (effectiveBranchId == null) {
    return { allowed: false, reason: 'MISSING_BRANCH_CONTEXT', grant };
  }

  if (!context.allowedBranchIds.includes(effectiveBranchId)) {
    return { allowed: false, reason: 'BRANCH_FORBIDDEN', grant };
  }

  return { allowed: true, reason: 'GRANTED_ASSIGNED', grant };
}

function normalizeScope(value: unknown): ScopeType | null {
  return value === 'GLOBAL' || value === 'BRANCH' || value === 'ASSIGNED' ? value : null;
}

function normalizeBranchIds(branchIds?: Array<number | null | undefined>): number[] {
  const unique = new Set<number>();
  for (const branchId of branchIds ?? []) {
    const value = toPositiveInteger(branchId);
    if (value != null) unique.add(value);
  }
  return [...unique];
}

function toPositiveInteger(value: number | string | null | undefined): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return Number.isInteger(numeric) && (numeric as number) > 0 ? (numeric as number) : null;
}
