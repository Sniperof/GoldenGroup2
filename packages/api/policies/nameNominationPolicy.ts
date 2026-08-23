import type { AuthContext } from '@golden-crm/shared';

export function hasNameNominationGlobalPermission(context: AuthContext, permission: string): boolean {
  return context.isSuperAdmin
    || context.grants.some((grant) => grant.permission === permission && grant.scope === 'GLOBAL');
}
