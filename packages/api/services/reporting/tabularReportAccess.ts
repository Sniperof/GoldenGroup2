import type { AuthContext, ListAccessPlan } from '@golden-crm/shared';
import { resolveListAccessScope } from '../authorizationService.js';
import { ReportingError } from './reportingError.js';
import type { ScopeMode } from './metricsCatalog.js';

export interface TabularReportRequestParams {
  branchId?: string | number | null;
  employeeId?: string | number | null;
  supervisorEmployeeId?: string | number | null;
  technicianEmployeeId?: string | number | null;
  telemarketerUserId?: string | number | null;
  visitStatus?: string | null;
  taskType?: string | null;
  search?: string | null;
  deviceModelId?: string | number | null;
  deviceModel?: string | null;
  deviceStatus?: string | null;
  warrantyStatus?: string | null;
  customerRating?: string | null;
  contactEmployeeId?: string | number | null;
  lastContactChannel?: string | null;
  replacedParts?: string | null;
  minPaidAmount?: string | number | null;
  maxPaidAmount?: string | number | null;
  installationFrom?: string | null;
  installationTo?: string | null;
  periodicMaintenanceFrom?: string | null;
  periodicMaintenanceTo?: string | null;
  completedVisitFrom?: string | null;
  completedVisitTo?: string | null;
  lastContactFrom?: string | null;
  lastContactTo?: string | null;
  incompleteVisitFrom?: string | null;
  incompleteVisitTo?: string | null;
  geoUnitId?: string | number | null;
  geoIds?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  page?: string | number | null;
  limit?: string | number | null;
}

export interface TabularReportAccess {
  scope: ScopeMode;
  grantedScope: ScopeMode;
  branchIds: number[];
  userId: number;
}

export function positiveInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function resolveTabularReportAccess(
  authContext: AuthContext,
  permission: string,
  params: TabularReportRequestParams,
  supportedScopes?: Array<'GLOBAL' | 'BRANCH' | 'ASSIGNED'>,
): TabularReportAccess {
  const plan = resolveListAccessScope(authContext, permission);
  assertSupportedScope(plan.scope, supportedScopes);
  return resolveAccessPlan(plan, params.branchId);
}

export function resolveTabularExportAccess(
  authContext: AuthContext,
  viewPermission: string,
  exportPermission: string,
  params: TabularReportRequestParams,
  supportedScopes?: Array<'GLOBAL' | 'BRANCH' | 'ASSIGNED'>,
): TabularReportAccess {
  const viewPlan = resolveListAccessScope(authContext, viewPermission);
  const exportPlan = resolveListAccessScope(authContext, exportPermission);
  if (viewPlan.scope === 'NONE' || exportPlan.scope === 'NONE') {
    throw new ReportingError(403, 'تصدير التقرير يتطلب صلاحيتي العرض والتصدير');
  }
  const rank = { ASSIGNED: 1, BRANCH: 2, GLOBAL: 3 } as const;
  const effectivePlan = rank[viewPlan.scope] <= rank[exportPlan.scope] ? viewPlan : exportPlan;
  assertSupportedScope(effectivePlan.scope, supportedScopes);
  return resolveAccessPlan(effectivePlan, params.branchId);
}

function assertSupportedScope(
  scope: ListAccessPlan['scope'],
  supportedScopes?: Array<'GLOBAL' | 'BRANCH' | 'ASSIGNED'>,
) {
  if (scope !== 'NONE' && supportedScopes && !supportedScopes.includes(scope)) {
    throw new ReportingError(403, 'نطاق الصلاحية الحالي غير مدعوم لهذا التقرير');
  }
}

export function resolveAccessPlan(plan: ListAccessPlan, branchId: unknown): TabularReportAccess {
  if (plan.scope === 'NONE') {
    throw new ReportingError(403, 'لا تملك صلاحية استخدام هذا التقرير');
  }

  const requestedBranchId = positiveInt(branchId);
  if (plan.scope === 'GLOBAL') {
    return requestedBranchId == null
      ? { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: plan.userId }
      : { scope: 'BRANCH', grantedScope: 'GLOBAL', branchIds: [requestedBranchId], userId: plan.userId };
  }

  if (plan.allowedBranchIds.length === 0) {
    throw new ReportingError(403, 'لا يوجد فرع فعّال ضمن نطاق التقرير');
  }
  if (requestedBranchId != null && !plan.allowedBranchIds.includes(requestedBranchId)) {
    throw new ReportingError(403, 'لا يمكنك استخدام التقرير على فرع غير مسموح');
  }

  return {
    scope: plan.scope,
    grantedScope: plan.scope,
    branchIds: requestedBranchId == null ? plan.allowedBranchIds : [requestedBranchId],
    userId: plan.userId,
  };
}
