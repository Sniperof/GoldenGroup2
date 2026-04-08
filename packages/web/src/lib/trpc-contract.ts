import {
  CreateHrUserInput,
  CreateRoleInput,
  HrUser,
  Permission,
  Role,
  SetPermissionsInput,
  UpdateHrUserInput,
  UpdateRoleInput,
} from '@golden-crm/shared';

export type RoleWithPermissions = Role & {
  permissions: Permission[];
};

export type DeleteRoleResult = {
  success: true;
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
    getPermissions: QueryProcedure<{ id: number }, Permission[]>;
    create: MutationProcedure<CreateRoleInput, Role>;
    update: MutationProcedure<UpdateRoleInput, Role>;
    delete: MutationProcedure<{ id: number }, DeleteRoleResult>;
    setPermissions: MutationProcedure<SetPermissionsInput, Permission[]>;
    allPermissions: QueryProcedure<void, Permission[]>;
    hrUsersList: QueryProcedure<void, HrUser[]>;
    createHrUser: MutationProcedure<CreateHrUserInput, HrUser>;
    updateHrUser: MutationProcedure<UpdateHrUserInput, HrUser>;
  };
}
