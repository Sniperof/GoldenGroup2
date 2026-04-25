import {
  BranchCatalogItem,
  CreateHrUserInput,
  CreateRoleInput,
  DeactivateUserBranchAssignmentInput,
  HrUser,
  Permission,
  RolePermissionGrant,
  Role,
  SetPrimaryUserBranchInput,
  SetPermissionsInput,
  UpsertUserBranchAssignmentInput,
  UpdateHrUserInput,
  UpdateRoleInput,
  UserBranchAssignment,
} from '@golden-crm/shared';

export type RoleWithPermissions = Role & {
  permissions: RolePermissionGrant[];
};

export type DeleteRoleResult = {
  success: true;
};

export type RoleUser = {
  id: number;
  name: string;
  username: string;
  isActive: boolean;
  roleId: number | null;
  roleDisplayName: string | null;
  createdAt: string;
  branchAssignments: Array<{
    branchId: number;
    branchName: string;
    isPrimary: boolean;
    status: string;
  }>;
};

type QueryProcedure<TInput, TOutput> = undefined extends TInput
  ? { query(): Promise<TOutput> }
  : { query(input: TInput): Promise<TOutput> };

type MutationProcedure<TInput, TOutput> = {
  mutate(input: TInput): Promise<TOutput>;
};

export interface AppRouterContract {
  roles: {
    list: QueryProcedure<void, Role[]>;
    getById: QueryProcedure<{ id: number }, RoleWithPermissions>;
    getPermissions: QueryProcedure<{ id: number }, RolePermissionGrant[]>;
    create: MutationProcedure<CreateRoleInput, Role>;
    update: MutationProcedure<UpdateRoleInput, Role>;
    delete: MutationProcedure<{ id: number }, DeleteRoleResult>;
    setPermissions: MutationProcedure<SetPermissionsInput, RolePermissionGrant[]>;
    allPermissions: QueryProcedure<void, Permission[]>;
    getRoleUsers: QueryProcedure<{ roleId: number }, RoleUser[]>;
    hrUsersList: QueryProcedure<void, HrUser[]>;
    createHrUser: MutationProcedure<CreateHrUserInput, HrUser>;
    updateHrUser: MutationProcedure<UpdateHrUserInput, HrUser>;
    branchCatalog: QueryProcedure<void, BranchCatalogItem[]>;
    getUserBranchAssignments: QueryProcedure<{ userId: number }, UserBranchAssignment[]>;
    upsertUserBranchAssignment: MutationProcedure<UpsertUserBranchAssignmentInput, UserBranchAssignment[]>;
    deactivateUserBranchAssignment: MutationProcedure<DeactivateUserBranchAssignmentInput, UserBranchAssignment[]>;
    setPrimaryUserBranchAssignment: MutationProcedure<SetPrimaryUserBranchInput, UserBranchAssignment[]>;
  };
}
