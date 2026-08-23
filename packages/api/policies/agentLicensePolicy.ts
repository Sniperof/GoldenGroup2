import type { AuthContext } from '@golden-crm/shared';

/** Agent-license review is deliberately central: branch and assigned grants never authorize it. */
export function hasAgentLicenseGlobalPermission(context: AuthContext, permission: string): boolean {
  return context.isSuperAdmin
    || context.grants.some((grant) => grant.permission === permission && grant.scope === 'GLOBAL');
}
