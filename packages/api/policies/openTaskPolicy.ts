import type { AuthContext, AuthorizationResult, ListAccessPlan } from '@golden-crm/shared';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';

/**
 * Open-tasks domain policy (engineering standard §4.3, §6).
 *
 * Record decisions route through `authorize()` so the grant scope is honored:
 *  - GLOBAL  → any branch (a company-wide operations role, not only super-admin)
 *  - BRANCH  → the union of the actor's effective branch assignments
 *  - ASSIGNED→ reserved for the future "my tasks" team views (filtered on top of
 *              these same branch/global gates — migration 287)
 *
 * The previous inline `branch_id !== actingBranchId` check collapsed BRANCH to a
 * single acting branch and silently dropped GLOBAL; this policy replaces it.
 */
export function canViewOpenTask(
  context: AuthContext,
  branchId: number | null,
): AuthorizationResult {
  return authorize(context, { permission: 'open_tasks.view', branchId });
}

export function canEditOpenTask(
  context: AuthContext,
  branchId: number | null,
): AuthorizationResult {
  return authorize(context, { permission: 'open_tasks.edit', branchId });
}

export function getOpenTaskListAccessPlan(context: AuthContext): ListAccessPlan {
  return resolveListAccessScope(context, 'open_tasks.view');
}
