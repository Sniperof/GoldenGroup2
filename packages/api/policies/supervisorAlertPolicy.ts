import type { AuthContext } from '@golden-crm/shared';
import { resolveListAccessScope } from '../services/authorizationService.js';

/** One branch per request; ASSIGNED additionally requires a record owner predicate. */
export function supervisorAlertAccessPlan(context: AuthContext): { branchId: number; scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED'; userId: number } | null {
  const plan = resolveListAccessScope(context, 'tasks.supervisor_alerts.view');
  const branchId = context.actingBranchId;
  if (plan.scope === 'NONE' || branchId == null || !Number.isInteger(branchId) || branchId <= 0) return null;
  if (plan.scope !== 'GLOBAL' && !plan.allowedBranchIds.includes(branchId)) return null;
  return { branchId, scope: plan.scope, userId: context.userId };
}
