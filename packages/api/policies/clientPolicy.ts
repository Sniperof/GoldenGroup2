import type { AuthContext, AuthorizationResult } from '@golden-crm/shared';
import { authorize } from '../services/authorizationService.js';

export interface ClientPolicySubject {
  branchId: number | null;
  assignedHrUserId?: number | null;
}

export interface ClientListAccessPlan {
  scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED' | 'NONE';
  userId: number;
  allowedBranchIds: number[];
}

function authorizeClientPermission(
  context: AuthContext,
  permission: string,
  client: ClientPolicySubject,
): AuthorizationResult {
  return authorize(context, {
    permission,
    branchId: client.branchId,
    assignedUserId: client.assignedHrUserId ?? null,
  });
}

export function canListClients(
  context: AuthContext,
  branchId: number | null,
): AuthorizationResult {
  return authorize(context, {
    permission: 'clients.view_list',
    branchId,
  });
}

export function getClientListAccessPlan(context: AuthContext): ClientListAccessPlan {
  if (context.isSuperAdmin) {
    return {
      scope: 'GLOBAL',
      userId: context.userId,
      allowedBranchIds: context.allowedBranchIds,
    };
  }

  const grant = context.grants.find(item => item.permission === 'clients.view_list');
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

export function canViewClient(
  context: AuthContext,
  client: ClientPolicySubject,
): AuthorizationResult {
  return authorizeClientPermission(context, 'clients.view', client);
}

export function canCreateClient(
  context: AuthContext,
  client: ClientPolicySubject,
): AuthorizationResult {
  return authorizeClientPermission(context, 'clients.create', client);
}

export function canEditClient(
  context: AuthContext,
  client: ClientPolicySubject,
): AuthorizationResult {
  return authorizeClientPermission(context, 'clients.edit', client);
}

export function canDeleteClient(
  context: AuthContext,
  client: ClientPolicySubject,
): AuthorizationResult {
  return authorizeClientPermission(context, 'clients.delete', client);
}
