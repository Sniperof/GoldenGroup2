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
  sortKey?: string | null;
  sortDir?: string | null;
  candidateNameSearch?: string | null;
  candidateSourceType?: string | null;
  candidateStatus?: string | null;
  candidateOutcome?: string | null;
  candidateDuplicateStatus?: string | null;
  candidateAddedFrom?: string | null;
  candidateAddedTo?: string | null;
  referralSheetNumber?: string | number | null;
  referralSheetFrom?: string | null;
  referralSheetTo?: string | null;
  mediatorName?: string | null;
  mediatorType?: string | null;
  mediatorVisitFrom?: string | null;
  mediatorVisitTo?: string | null;
  accompanyingTechnicianId?: string | number | null;
  giftPromiseStatus?: string | null;
  occupation?: string | null;
  contractStatus?: string | null;
  sellerEmployeeId?: string | number | null;
  sellerDepartmentTypeId?: string | number | null;
  paymentType?: string | null;
  executionStage?: string | null;
  saleType?: string | null;
  saleSubtype?: string | null;
  remainingBalance?: string | null;
  contractId?: string | number | null;
  deviceModelIds?: string | null;
  departmentTypeId?: string | number | null;
  financialAsOfDate?: string | null;
  collectionOwnerId?: string | number | null;
  saleCloserUserId?: string | number | null;
  latestCollectionResult?: string | null;
  faultTypeId?: string | number | null;
  faultStatus?: string | null;
  faultDiscoveryPhase?: string | null;
  repairTechnicianEmployeeId?: string | number | null;
  faultResolvedFrom?: string | null;
  faultResolvedTo?: string | null;
  faultDurationBucket?: string | null;
  faultPartsUsage?: string | null;
  retrievalPurpose?: string | null;
  retrievalTechnicianEmployeeId?: string | number | null;
  retrievedDeviceStatus?: string | null;
  opFrom?: string | null;
  opTo?: string | null;
  contractFrom?: string | null;
  contractTo?: string | null;
  giftDeliveryFrom?: string | null;
  giftDeliveryTo?: string | null;
  giftConditionStatus?: string | null;
  giftDeliveryResult?: string | null;
  giftDefinitionId?: string | number | null;
  callOutcome?: string | null;
  visitTechnicianEmployeeId?: string | number | null;
  retrievalSource?: string | null;
  originBranchId?: string | number | null;
  lastVisitFrom?: string | null;
  lastVisitTo?: string | null;
  routeId?: string | number | null;
  areaEvaluation?: string | null;
  evaluationConfidence?: string | null;
  periodicPressure?: string | null;
  departmentId?: string | number | null;
  jobTitle?: string | null;
  employmentStatus?: string | null;
  technicianActivity?: string | null;
  callBookingPresence?: string | null;
  receivableSourceType?: string | null;
  collectionAppointmentFrom?: string | null;
  collectionAppointmentTo?: string | null;
  collectionAppointmentPresence?: string | null;
  taskResult?: string | null;
  cancellationReasonId?: string | number | null;
  visitOrigin?: string | null;
}

/**
 * Every request key a report may read, in one place.
 *
 * Why a list and not two hand-written pick blocks: the HTTP layer used to spell out
 * the keys it forwarded, and eleven of them (the whole fault and retrieval filter
 * set) were never added — the UI sent them, the route dropped them, and the report
 * generated as if the user had filtered nothing. A dropped filter that widens the
 * result is exactly the silent fallback the permissions standard forbids, so the
 * list lives beside the interface and `tabularReportAccess.test.ts` fails the build
 * if a field is declared without being added here.
 */
export const TABULAR_REQUEST_PARAM_KEYS = [
  'branchId', 'employeeId', 'supervisorEmployeeId', 'technicianEmployeeId', 'telemarketerUserId',
  'visitStatus', 'taskType', 'search', 'deviceModelId', 'deviceModel', 'deviceStatus',
  'warrantyStatus', 'customerRating', 'contactEmployeeId', 'lastContactChannel', 'replacedParts',
  'minPaidAmount', 'maxPaidAmount',
  'installationFrom', 'installationTo', 'periodicMaintenanceFrom', 'periodicMaintenanceTo',
  'completedVisitFrom', 'completedVisitTo', 'lastContactFrom', 'lastContactTo',
  'incompleteVisitFrom', 'incompleteVisitTo',
  'geoUnitId', 'geoIds', 'fromDate', 'toDate', 'page', 'limit', 'sortKey', 'sortDir',
  'candidateNameSearch', 'candidateSourceType', 'candidateStatus', 'candidateOutcome',
  'candidateDuplicateStatus', 'candidateAddedFrom', 'candidateAddedTo',
  'referralSheetNumber', 'referralSheetFrom', 'referralSheetTo',
  'mediatorName', 'mediatorType', 'mediatorVisitFrom', 'mediatorVisitTo',
  'accompanyingTechnicianId', 'giftPromiseStatus', 'occupation',
  'contractStatus', 'sellerEmployeeId', 'sellerDepartmentTypeId', 'paymentType', 'executionStage',
  'saleType', 'saleSubtype', 'remainingBalance', 'contractId', 'deviceModelIds', 'departmentTypeId',
  'financialAsOfDate', 'collectionOwnerId', 'saleCloserUserId', 'latestCollectionResult',
  'faultTypeId', 'faultStatus', 'faultDiscoveryPhase', 'repairTechnicianEmployeeId',
  'faultResolvedFrom', 'faultResolvedTo', 'faultDurationBucket', 'faultPartsUsage',
  'retrievalPurpose', 'retrievalTechnicianEmployeeId', 'retrievedDeviceStatus',
  'opFrom', 'opTo', 'contractFrom', 'contractTo', 'giftDeliveryFrom', 'giftDeliveryTo',
  'giftConditionStatus', 'giftDeliveryResult', 'giftDefinitionId', 'callOutcome',
  'visitTechnicianEmployeeId', 'retrievalSource', 'originBranchId',
  'lastVisitFrom', 'lastVisitTo', 'routeId',
  'areaEvaluation', 'evaluationConfidence', 'periodicPressure',
  'departmentId', 'jobTitle', 'employmentStatus', 'technicianActivity', 'callBookingPresence',
  'receivableSourceType', 'collectionAppointmentFrom', 'collectionAppointmentTo',
  'collectionAppointmentPresence', 'taskResult', 'cancellationReasonId', 'visitOrigin',
] as const satisfies ReadonlyArray<keyof TabularReportRequestParams>;

/**
 * Lifts the known keys out of a query string or a JSON body. Only scalars pass:
 * an object or array would otherwise reach a `= ANY(...)` predicate as a value the
 * report never validated.
 */
export function readTabularReportRequestParams(source: unknown): TabularReportRequestParams {
  const record = (source ?? {}) as Record<string, unknown>;
  const params: Record<string, string | number> = {};
  for (const key of TABULAR_REQUEST_PARAM_KEYS) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') params[key] = value;
  }
  return params as TabularReportRequestParams;
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
