import type { AuthContext, AuthorizationResult, ListAccessPlan } from '@golden-crm/shared';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';

/**
 * Field-visits domain policy (engineering standard §4.3, §6).
 *
 * Mirrors openTaskPolicy: record decisions go through `authorize()` so GLOBAL
 * (company-wide) and multi-branch BRANCH grants are honored, replacing the
 * inline `branch_id !== actingBranchId` checks scattered across fieldVisits.ts.
 * ASSIGNED is reserved for the future "my visits" team views.
 */
export function canViewFieldVisit(
  context: AuthContext,
  branchId: number | null,
): AuthorizationResult {
  return authorize(context, { permission: 'field_visits.view', branchId });
}

export function canEditFieldVisit(
  context: AuthContext,
  branchId: number | null,
): AuthorizationResult {
  return authorize(context, { permission: 'field_visits.edit', branchId });
}

export function getFieldVisitListAccessPlan(context: AuthContext): ListAccessPlan {
  return resolveListAccessScope(context, 'field_visits.view');
}
