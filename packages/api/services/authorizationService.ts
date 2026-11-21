import type {
  AuthContext,
  AuthUser,
  AuthorizationCheck,
  AuthorizationResult,
  ListAccessPlan,
  PermissionGrant,
  ScopeType,
} from '@golden-crm/shared';
import { hasCrossBranchReach } from '@golden-crm/shared';
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
      canReachAnyBranch: hasCrossBranchReach(isSuperAdmin, loaded.grants),
    }),
  };
}

/** The shared rule (packages/shared/branchReach.ts) — same definition the web switcher uses. */
export { hasCrossBranchReach };

/**
 * The branch a write lands in when the request names none. For a single-branch
 * user that is their own branch (they have no switcher; the badge shows it).
 * For a cross-branch user it is NOTHING: with "all branches" selected there is
 * no branch to infer, so the caller must answer "pick a branch" instead of
 * quietly writing into the user's home branch (standard §13 SH-3).
 */
export function defaultWriteBranchId(context: Pick<AuthContext, 'isSuperAdmin' | 'grants' | 'actingBranchId' | 'allowedBranchIds'>): number | null {
  if (hasCrossBranchReach(context.isSuperAdmin, context.grants)) {
    return context.actingBranchId ?? null;
  }
  return context.actingBranchId ?? context.allowedBranchIds[0] ?? null;
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
    /**
     * The actor holds a GLOBAL list view (see hasCrossBranchReach) and so is
     * offered every branch by the switcher. Their selected branch becomes the
     * acting branch even when it is not one of their assignments. This does NOT
     * widen allowedBranchIds: BRANCH/ASSIGNED grants are still checked against
     * the assignments, so only GLOBAL grants reach the selected branch.
     *
     * With NO selection ("all branches") such an actor has no acting branch:
     * falling back to their home branch made branch-level pages act on it while
     * the screen said «كل الفروع».
     */
    canReachAnyBranch?: boolean;
  },
): number | null {
  const requestedBranchId = toPositiveInteger(options.headerBranchId);
  const primaryBranchId = toPositiveInteger(options.primaryBranchId);
  const allowedBranchIds = normalizeBranchIds(options.allowedBranchIds);

  if (requestedBranchId == null) {
    return options.canReachAnyBranch === true ? null : primaryBranchId;
  }

  if (options.isSuperAdmin === true) {
    // A super admin reaches ANY branch — their own branch assignments must never
    // restrict them. Previously a super admin who happened to hold assignments was
    // limited to them, so requesting an unassigned branch (e.g. طرطوس) resolved to
    // null and the branch-only guard returned 403, while branches they were assigned
    // to worked — an inconsistency vs GLOBAL managers (who saw every branch).
    return requestedBranchId;
  }

  // Same reasoning for a company-wide (GLOBAL list) operator: the switcher
  // offers them every branch, so dropping an unassigned selection to null made
  // the selected branch silently disappear server-side (empty lists / 403s).
  if (options.canReachAnyBranch === true) {
    return requestedBranchId;
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

/**
 * Translate the actor's grant for `permission` into a list-scope plan. This is
 * the read-side complement of `authorize()` (which decides a single record):
 * list/index endpoints call this once to build their branch predicate.
 *
 * Permission-agnostic by design so it scales to every operations/tasks list
 * (open_tasks, field_visits, tasks, and any future task type) without copying
 * the GLOBAL/BRANCH/ASSIGNED/NONE branching into each route.
 */
export function resolveListAccessScope(
  context: AuthContext,
  permission: string,
): ListAccessPlan {
  if (context.isSuperAdmin) {
    return {
      scope: 'GLOBAL',
      userId: context.userId,
      allowedBranchIds: context.allowedBranchIds,
    };
  }

  const grant = context.grants.find(item => item.permission === permission);
  if (!grant) {
    return {
      scope: 'NONE',
      userId: context.userId,
      allowedBranchIds: context.allowedBranchIds,
    };
  }

  return {
    scope: grant.scope,
    userId: context.userId,
    allowedBranchIds: context.allowedBranchIds,
  };
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

  const assignmentBranchIds = normalizeBranchIds(assignmentRows.map(row => row.branchId));
  // PHASE2B_LEGACY_FALLBACK
  // TEMP: while some users still have no active user_branch_assignments rows,
  // treat hr_users.branch_id as their only allowed branch instead of only using
  // it as the acting branch. This preserves BRANCH-scope checks without widening
  // access beyond the legacy branch.
  const allowedBranchIds = assignmentBranchIds.length > 0
    ? assignmentBranchIds
    : normalizeBranchIds([legacyBranchId]);
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
    `SELECT p.key AS permission,
            p.allowed_scopes AS "allowedScopes",
            rpg.scope_type AS scope
       FROM role_permission_grants rpg
       JOIN permissions p ON p.id = rpg.permission_id
      WHERE rpg.role_id = $1`,
    [roleId],
  );

  return rows
    .map(row => {
      const scope = normalizeScope(row.scope);
      if (
        !scope
        || typeof row.permission !== 'string'
        || !isPermissionGrantScopeAllowed(scope, row.allowedScopes)
      ) {
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
    // No record and no acting branch: only a cross-branch actor with "all
    // branches" selected lands here (single-branch actors always act on their
    // own branch). The question is then "may you use this endpoint?" — yes,
    // within your assignments, which the endpoint applies (resolveBranchView).
    if (hasCrossBranchReach(context.isSuperAdmin, context.grants) && context.allowedBranchIds.length > 0) {
      return { allowed: true, reason: 'GRANTED_BRANCH', grant };
    }
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
    // Same case as the BRANCH grant above: a cross-branch actor on "all
    // branches" opening a personal surface (e.g. «زياراتي») — the endpoint
    // scopes to their own records inside their assignments.
    if (
      check.branchId == null
      && hasCrossBranchReach(context.isSuperAdmin, context.grants)
      && context.allowedBranchIds.length > 0
    ) {
      return { allowed: true, reason: 'GRANTED_ASSIGNED', grant };
    }
    return { allowed: false, reason: 'MISSING_BRANCH_CONTEXT', grant };
  }

  if (!context.allowedBranchIds.includes(effectiveBranchId)) {
    // A personal surface asked without a record (check.branchId unset) is about
    // the actor's OWN items; a cross-branch actor who switched to a branch they
    // are not assigned to must still reach «زياراتي». A concrete record in that
    // branch (check.branchId set) stays refused.
    if (
      check.branchId == null
      && hasCrossBranchReach(context.isSuperAdmin, context.grants)
      && context.allowedBranchIds.length > 0
    ) {
      return { allowed: true, reason: 'GRANTED_ASSIGNED', grant };
    }
    return { allowed: false, reason: 'BRANCH_FORBIDDEN', grant };
  }

  return { allowed: true, reason: 'GRANTED_ASSIGNED', grant };
}

function normalizeScope(value: unknown): ScopeType | null {
  return value === 'GLOBAL' || value === 'BRANCH' || value === 'ASSIGNED' ? value : null;
}

export function isPermissionGrantScopeAllowed(
  scope: ScopeType,
  allowedScopes: unknown,
): boolean {
  if (!Array.isArray(allowedScopes)) return false;
  return allowedScopes.some(item => normalizeScope(item) === scope);
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
