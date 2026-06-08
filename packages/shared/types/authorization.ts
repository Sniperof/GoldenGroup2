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
