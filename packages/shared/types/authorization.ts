export const SCOPE_TYPES = ['GLOBAL', 'BRANCH', 'ASSIGNED'] as const;

export type ScopeType = typeof SCOPE_TYPES[number];

export interface PermissionGrant {
  permission: string;
  scope: ScopeType;
}

export interface AuthContext {
  userId: number;
  roleId: number | null;
  isSuperAdmin: boolean;
  grants: PermissionGrant[];
  allowedBranchIds: number[];
  actingBranchId: number | null;
}

export interface AuthorizationCheck {
  permission: string;
  branchId?: number | null;
  assignedUserId?: number | null;
}

/**
 * List-scope plan derived from a single permission grant. Used by list/index
 * endpoints to translate the actor's grant scope into a branch predicate:
 *  - GLOBAL   → no branch constraint (optionally narrowed by a query filter)
 *  - BRANCH   → branch_id ∈ allowedBranchIds (union of effective assignments)
 *  - ASSIGNED → branch_id ∈ allowedBranchIds AND assigned-to-actor filter
 *  - NONE     → no grant; caller must reject (403) or return empty
 *
 * `scope` is intentionally permission-agnostic so the same helper scales to any
 * operations/tasks list (open_tasks, field_visits, tasks, future task types).
 */
export interface ListAccessPlan {
  scope: ScopeType | 'NONE';
  userId: number;
  allowedBranchIds: number[];
}

export interface AuthorizationResult {
  allowed: boolean;
  reason:
    | 'SUPER_ADMIN'
    | 'GRANTED_GLOBAL'
    | 'GRANTED_BRANCH'
    | 'GRANTED_ASSIGNED'
    | 'MISSING_PERMISSION'
    | 'MISSING_BRANCH_CONTEXT'
    | 'BRANCH_FORBIDDEN'
    | 'ASSIGNMENT_FORBIDDEN';
  grant?: PermissionGrant;
}
