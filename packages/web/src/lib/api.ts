import type {
  MarketingVisitCancelRequest,
  MarketingVisitRescheduleRequest,
  DevicePossessionEntry,
  TaskTypeConfig,
  ZoneStudyMode,
  ZoneStudyResponse,
} from '@golden-crm/shared';
import { shouldAttachBranchContextHeader } from './branchContext';
import { authFetch } from './authFetch';
import { DEVICE_BLOCK_MESSAGE_KEY, deviceClassHeader, readDeviceBlock } from './deviceClass';

export const API_BASE = '/api';

export interface AccountStatementEntry {
  id: number;
  entry_date: string;
  entry_type: string;            // = source_type (لفلاتر العرض)
  kind: 'charge' | 'payment' | 'refund' | 'discount';
  source_type: string;
  source_id: number | null;
  contract_id: number | null;
  description: string;
  reference_no: string | null;
  debit_amount: number;
  credit_amount: number;
  running_balance: number;
  is_upcoming: boolean;
}

export interface AccountStatementResponse {
  summary: {
    current_balance: number;     // المستحق الآن (حتى اليوم)
    total_paid: number;
    upcoming_total: number;      // الاستحقاقات القادمة
    overdue_amount: number;
  };
  entries: AccountStatementEntry[];
}

// GET /clients/paged — server-side pagination companion to clients.list()
// (isolated: list() is unchanged). See docs/analysis/clients-records-performance-and-filters.md
// ── Mobile home-screen banners (migration 422) ──────────────────────────────

// ── Free-form app notifications (DEC-019 D-N6/D-N7) ──────────────────────────
export type BroadcastDestination =
  | 'service_request' | 'device' | 'warranty' | 'complaint' | 'visit'
  /** Intake FORM for a request type — its id is a request_type slug, not a row id. */
  | 'service_request_form';

export interface BroadcastAudienceInput {
  /** Optional narrowing. The server applies the operator's branch ceiling on top. */
  branchId?: number | null;
  /** Geo subtree of the deepest selected level, as GeoCascadeFilter emits it. */
  geoIds?: string[];
  clientId?: number | null;
}

export interface BroadcastAudiencePreview {
  audience: BroadcastAudienceInput;
  /** Inboxes that would receive the notification. */
  accounts: number;
  /** Distinct customers behind those inboxes. */
  clients: number;
  /** Of those, how many have a registered device; the rest see it only in-app. */
  reachableByPush: number;
}

export interface BroadcastInput {
  title: string;
  message: string;
  locale: 'ar' | 'en';
  destination?: BroadcastDestination | null;
  destinationId?: string | null;
  audience: BroadcastAudienceInput;
  /** What the operator was shown, stored beside what was actually written. */
  previewedCount?: number | null;
}

export interface BroadcastRecord {
  id: string;
  title: string;
  message: string;
  locale: 'ar' | 'en';
  destination: BroadcastDestination | null;
  destinationId: string | null;
  audience: BroadcastAudienceInput;
  previewedCount: number | null;
  notificationCount: number;
  branchId: number | null;
  branchName: string | null;
  sentBy: string | null;
  createdAt: string;
  completedAt: string | null;
  lastError: string | null;
}

export type AppHomeBannerTargetKind = 'none' | 'device' | 'service_request' | 'external_url';
export type AppHomeBannerAudience = 'all' | 'customers' | 'guests';

export interface AppHomeBannerInput {
  titleAr: string | null;
  /** Must be a '/m/<id>.webp' returned by uploadMedia() (or a legacy '/uploads/' path); the API rejects anything else. */
  imageUrl: string;
  sortOrder: number;
  displaySeconds: number;
  startsAt: string | null;
  endsAt: string | null;
  targetKind: AppHomeBannerTargetKind;
  targetDeviceModelId: number | null;
  targetRequestType: string | null;
  targetUrl: string | null;
  audience: AppHomeBannerAudience;
  isActive: boolean;
}

export interface AppHomeBanner extends AppHomeBannerInput {
  id: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppHomeBannerTargetOptions {
  devices: { id: number; nameAr: string; category: string | null }[];
  /** Only the request types the mobile app can currently open a form for. */
  requestTypes: { requestType: string; labelAr: string }[];
}

// ── Mobile contact/social links (migration 424) ─────────────────────────────

export interface AppContactLinksInput {
  facebookUrl: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  whatsappNumber: string | null;
  telegramNumber: string | null;
}

export interface AppContactLinks extends AppContactLinksInput {
  updatedAt: string;
}

export interface PagedClientsResponse {
  items: any[];
  total: number;
  page: number;
  limit: number;
  kpis: { total: number; leads: number; fops: number; ops: number };
}

/** GET /candidates/paged — `kpis` is keyed by candidate status; `total` is their sum. */
export interface PagedCandidatesResponse {
  items: any[];
  total: number;
  page: number;
  limit: number;
  kpis: Record<string, number>;
}

export interface PagedCandidatesParams {
  branchId?: number | null;      // narrows a GLOBAL viewer to one branch (X-Branch-Id)
  page?: number;
  limit?: number;
  sortKey?: string;              // createdAt | id | firstName | lastName | mobile | status | referralDate | branchName
  sortDir?: 'asc' | 'desc';
  ids?: string;                  // comma-joined ids — scoped batch lookup for surfaces needing specific rows
  search?: string;               // name / nickname / mobile / referrer snapshot
  status?: string;
  branchFilterId?: number;       // explicit branch filter, always ANDed with the caller's scope
                                 // (distinct from `branchId`, which becomes the X-Branch-Id header)
  responsibleUserId?: number;
  createdByUserId?: number;
  converted?: 'converted' | 'unconverted' | '';
  referralType?: string;
  channel?: string;
  duplicate?: 'yes' | 'no' | '';
  confirmation?: string;
  source?: 'fromSheet' | 'direct' | '';
  referralSheetId?: number;
  referralEntityId?: number;     // the referring entity (client id when referralType = Client)
  geoUnitId?: number;
  dateFrom?: string;             // YYYY-MM-DD
  dateTo?: string;               // YYYY-MM-DD (inclusive)
}

export interface PagedClientsParams {
  branchId?: number | null;      // narrows a GLOBAL viewer to one branch (X-Branch-Id)
  page?: number;
  limit?: number;
  search?: string;
  filterClass?: string;          // Lead | FOP | OP
  filterMediator?: string;       // Personal | Employee | Client
  // Enriched catalog (docs/analysis/clients-records-performance-and-filters.md §7)
  geoIds?: string;               // comma-joined subtree ids of the deepest selected geo level
  routeGeoIds?: string;          // comma-joined subtree ids of a route's points
  owner?: string | number;       // assigned hr_user id
  rating?: string;               // Committed | NotCommitted | Undefined
  referredByClientId?: number;   // clients this client referred (flat columns + referrers JSONB)
  waterSource?: string;          // admin-list value
  dataQuality?: string;          // correct | incorrect | needs_edit
  createdFrom?: string;          // YYYY-MM-DD
  createdTo?: string;            // YYYY-MM-DD
  serial?: string;               // device serial (partial)
  hasDevice?: string;            // yes | no
  taskType?: string;             // open_task task_type (has an ACTIVE task of this type)
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
}

export interface ReportColumnDefinition {
  key: string;
  titleAr: string;
  type: 'text' | 'integer' | 'decimal' | 'date' | 'datetime' | 'link';
  width: number;
  sortable?: boolean;
}

export interface ReportCatalogItem {
  key: string;
  groupKey: string;
  title: string;
  description: string;
  question: string;
  grain: string;
  viewScope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED';
  canExport: boolean;
  exportScope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED' | null;
  columns: ReportColumnDefinition[];
  filters: {
    dateRange: 'none' | 'required';
    geography: boolean;
    supervisor: boolean;
    technician: boolean;
    telemarketer: boolean;
    visitStatus: boolean;
    taskType?: boolean;
    search?: boolean;
    deviceModel?: boolean;
    deviceStatus?: boolean;
    warrantyStatus?: boolean;
    customerRating?: boolean;
    contactEmployee?: boolean;
    lastContactChannel?: boolean;
    replacedParts?: boolean;
    paidAmount?: boolean;
    dateRanges?: Array<{ fromKey: string; toKey: string; label: string }>;
    primaryDateRanges?: Array<{ fromKey: string; toKey: string; label: string }>;
    candidateNameSearch?: boolean;
    candidateSourceType?: boolean;
    candidateStatus?: boolean;
    candidateOutcome?: boolean;
    candidateDuplicateStatus?: boolean;
    referralSheetNumber?: boolean;
    mediatorName?: boolean;
    mediatorType?: boolean;
    accompanyingTechnician?: boolean;
    giftPromiseStatus?: boolean;
    occupation?: boolean;
    contractStatus?: boolean;
    contractSeller?: boolean;
    contractSellerDepartment?: boolean;
    contractPaymentType?: boolean;
    contractExecutionStage?: boolean;
    contractSaleType?: boolean;
    reportDeviceModels?: boolean;
    reportDeviceModelsRequired?: boolean;
    callEmployee?: boolean;
    callOutcome?: boolean;
    departmentType?: boolean;
    contractSaleSubtype?: boolean;
    contractRemainingBalance?: boolean;
    contractSale?: boolean;
    financialAsOfDate?: boolean;
    collectionOwner?: boolean;
    saleCloser?: boolean;
    latestCollectionResult?: boolean;
    faultType?: boolean;
    faultStatus?: boolean;
    faultDiscoveryPhase?: boolean;
    repairTechnician?: boolean;
    faultDuration?: boolean;
    faultPartsUsage?: boolean;
    retrievalPurpose?: boolean;
    retrievalTechnician?: boolean;
    retrievedDeviceStatus?: boolean;
    giftConditionStatus?: boolean;
    giftDeliveryResult?: boolean;
    giftDefinition?: boolean;
  };
  guide: {
    framingTitle: string;
    framingDescription: string;
    rowDescription: string;
    columnDescriptions: Record<string, string>;
    note?: string;
  };
}

export interface ReportCatalogGroup {
  key: string;
  title: string;
  description: string;
  reports: ReportCatalogItem[];
}

export interface TabularReportResponse {
  runId: string;
  status: 'completed';
  report: Omit<ReportCatalogItem, 'viewScope' | 'canExport' | 'exportScope'>;
  scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED';
  branchIds: number[];
  filters: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  pagination: { page: number; limit: number; total: number; pages: number };
  generatedAt: string;
  requestedAt: string;
  expiresAt: string;
  progress: { rows: number; batches: number };
}

export interface TabularReportPendingResponse {
  runId: string;
  status: 'queued' | 'running' | 'failed';
  requestedAt: string;
  expiresAt: string;
  startedAt?: string | null;
  generatedAt?: string | null;
  progress: { rows: number; batches: number };
  error?: string | null;
}

export type TabularReportRunResponse = TabularReportResponse | TabularReportPendingResponse;

export interface ReportFilterOptions {
  supervisors: Array<{ value: string; label: string }>;
  technicians: Array<{ value: string; label: string }>;
  telemarketers: Array<{ value: string; label: string }>;
  visitStatuses: Array<{ value: string; label: string }>;
  taskTypes: Array<{ value: string; label: string }>;
  deviceModels: Array<{ value: string; label: string }>;
  deviceStatuses: Array<{ value: string; label: string }>;
  warrantyStatuses: Array<{ value: string; label: string }>;
  customerRatings: Array<{ value: string; label: string }>;
  contactEmployees: Array<{ value: string; label: string }>;
  candidateStatuses: Array<{ value: string; label: string }>;
  accompanyingTechnicians: Array<{ value: string; label: string }>;
  giftPromiseStatuses: Array<{ value: string; label: string }>;
  contractStatuses: Array<{ value: string; label: string }>;
  contractSellers: Array<{ value: string; label: string }>;
  contractSellerDepartments: Array<{ value: string; label: string }>;
  contractSales: Array<{ value: string; label: string }>;
  collectionOwners: Array<{ value: string; label: string }>;
  saleClosers: Array<{ value: string; label: string }>;
  departmentTypes: Array<{ value: string; label: string }>;
  callEmployees: Array<{ value: string; label: string }>;
  callOutcomes: Array<{ value: string; label: string }>;
  faultTypes: Array<{ value: string; label: string }>;
  repairTechnicians: Array<{ value: string; label: string }>;
  retrievalTechnicians: Array<{ value: string; label: string }>;
  retrievedDeviceStatuses: Array<{ value: string; label: string }>;
  giftDefinitions: Array<{ value: string; label: string }>;
}

// GET /contracts/paged — server pagination companion to contracts.list()
// (isolated: list() unchanged). Contracts are branch-only (no ASSIGNED tier).
export interface PagedContractsResponse {
  items: any[];
  total: number;
  page: number;
  limit: number;
}

export interface PagedContractsParams {
  branchId?: number | null;      // narrows a GLOBAL viewer to one branch (X-Branch-Id)
  customerId?: number;
  page?: number;
  limit?: number;
  search?: string;
  status?: string;               // draft | active | completed | cancelled
  paymentType?: string;          // cash | installment
  // Enriched catalog (docs/analysis/contracts-records-performance-filters-and-stats.md §3)
  saleType?: string;             // tradein | retention | direct
  oldDeviceCondition?: string;   // good | damaged (trade-in statistics)
  saleSubtype?: string;          // definitive | temporary | free
  saleOwner?: string | number;   // employee id
  closingEmployee?: string | number;
  deviceModel?: string | number;
  dateFrom?: string;             // YYYY-MM-DD (contract_date)
  dateTo?: string;
  priceMin?: string | number;
  priceMax?: string | number;
  hasDevice?: string;            // yes | no
  goldenWarranty?: string;       // yes | no
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
}

export interface PagedInstalledDevicesResponse {
  items: any[];
  total: number;
  page: number;
  limit: number;
}

export interface PagedInstalledDevicesParams {
  branchId?: number | null;      // narrows a GLOBAL viewer to one branch (X-Branch-Id)
  customerId?: number;
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  deviceSource?: string;         // company_contract | external
  goldenWarranty?: string;       // true | false
  saleSubtype?: string;          // definitive | temporary | free
  deviceModel?: string | number;
  geoIds?: string;               // comma-separated geo subtree ids
  installFrom?: string;          // YYYY-MM-DD
  installTo?: string;
  hasServiceAgreement?: string;  // yes | no
  warrantyExpiringDays?: string | number;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
}

// ── Reporting & analytics (reporting-analytics §1.3) ─────────────────────────
export interface MetricResponse {
  metricKey: string;
  title: string;
  unit: 'count' | 'percent';
  value: number;
  previous: number | null;
  deltaPct: number | null;
  scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED';
  branchIds: number[];
  computedAt: string;
  fromCache: boolean;
}

export interface BreakdownGroup {
  key: string;
  label: string;
  value: number;
  value2?: number;
}

export interface BreakdownResponse {
  metricKey: string;
  title: string;
  kind: 'funnel' | 'ranked-bar' | 'donut' | 'timeline';
  valueUnit: 'count' | 'percent';
  secondaryLabel: string | null;
  groups: BreakdownGroup[];
  total: number;
  scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED';
  branchIds: number[];
  computedAt: string;
  fromCache: boolean;
}

export interface DashboardWidget {
  key: string;
  size: 'sm' | 'md' | 'lg';
  scope: { branchId?: number } | null;
}

export interface EmergencyResultContext {
  visitId: number;
  visitTaskId: number;
}

export type PlanningExclusionLayer =
  | 'TEAM_DAY'
  | 'ALL_TEAMS_DAY'
  | 'CLIENT_DO_NOT_CONTACT';
export type PlanningCurationAction =
  | 'EXCLUDE'
  | 'RESTORE'
  | 'SET_DO_NOT_CONTACT'
  | 'CLEAR_DO_NOT_CONTACT';
export type PlanningTargetMode =
  | 'MATCHING_TASKS'
  | 'ALL_TASKS_OF_MATCHED_CONTACTS'
  | 'NON_MATCHING_TASKS_OF_MATCHED_CONTACTS';

export interface PlanningDashboardFilters {
  q?: string;
  lifecycleStatuses?: Array<'ready' | 'queued' | 'in_call_list' | 'contacted' | 'closed'>;
  stationIds?: number[];
  classifications?: string[];
  ownershipTypes?: string[];
  minTaskCount?: number;
  maxTaskCount?: number;
  taskIds?: number[];
  taskTypes?: string[];
  taskFamilies?: string[];
  taskStatuses?: string[];
  priorities?: string[];
  dueState?: 'OVERDUE' | 'ON_DATE' | 'FUTURE' | 'NO_DATE';
  attemptsMin?: number;
  phoneState?: 'VALID' | 'MISSING';
  exclusionLayers?: Array<PlanningExclusionLayer | 'NONE'>;
}

export type PlanningCurationSelector =
  | { kind: 'TASK_IDS'; taskIds: number[] }
  | { kind: 'CONTACT_KEYS'; contactKeys: string[] }
  | {
      kind: 'FILTERED_SET';
      filters: PlanningDashboardFilters;
      queryFingerprint: string;
      targetMode: PlanningTargetMode;
      exceptTaskIds?: number[];
      exceptContactKeys?: string[];
    };

export interface PlanningCurationTask {
  taskId: number;
  clientId: number;
  taskType: string;
  taskTypeLabel: string;
  taskFamily: string;
  status: string;
  priority: string | null;
  dueDate: string | null;
  expectedDate: string | null;
  createdAt: string;
  attemptCount: number;
  matchesTaskFilters: boolean;
  assignment: { teamKey: string | null; date: string | null; committed: boolean };
  blocks: {
    clientDoNotContact: boolean;
    clientCooldown: boolean;
    allTeamsDay: boolean;
    currentTeamDay: boolean;
  };
  exclusionReasonCode: string | null;
  exclusionReasonText: string | null;
  availableActions: string[];
}

export interface PlanningCurationRow {
  rowKey: string;
  clientId: number;
  clientName: string;
  primaryPhone: string | null;
  classification: string | null;
  ownershipType: string;
  ownerLabel: string;
  workLocationGeoUnitId: number | null;
  workLocationName: string | null;
  lifecycleStatus: 'ready' | 'queued' | 'in_call_list' | 'contacted' | 'closed';
  contactTarget: { id: number; status: string; closingReason: string | null; attemptCount: number } | null;
  listState: { generated: boolean; itemCount: number; committedTaskCount: number };
  contactBlocks: { doNotContact: boolean; cooldownUntil: string | null };
  counts: { totalTasks: number; matchingTasks: number; actionableTasks: number };
  tasks: PlanningCurationTask[];
}

export interface PlanningCurationDashboardResponse {
  date: string;
  teamKey: string;
  teamLabel: string;
  planState: 'PRE_GENERATION' | 'COMMITTED';
  generatedAt: string | null;
  rows: PlanningCurationRow[];
  pagination: { page: number; limit: number; totalContacts: number; totalPages: number };
  summary: {
    contacts: number;
    tasks: number;
    matchingTasks: number;
    actionableTasks: number;
    matchingActionableTasks: number;
    includedTodayTasks: number;
    excludedTodayTasks: number;
    ready: number;
    queued: number;
    in_call_list: number;
    contacted: number;
    closed: number;
    excludedTeamDay: number;
    excludedAllTeamsDay: number;
    blockedCustomers: number;
  };
  facets: {
    stations: Array<{ value: number; label: string; count: number }>;
    taskTypes: Array<{ value: string; label: string; count: number }>;
    taskFamilies: Array<{ value: string; label: string; count: number }>;
    priorities: Array<{ value: string; label: string; count: number }>;
  };
  queryFingerprint: string;
  cycle: PlanningDayCycle;
}

export interface PlanningDayCycleSummary {
  contactTargetsClosed: number;
  taskListsClosed: number;
  linksClosed: number;
  tasksReleased: number;
  preservedBookings: number;
  activeLocks: number;
}

export interface PlanningDayCycle {
  status: 'planning' | 'ready' | 'active' | 'closing' | 'closed';
  activatedAt: string | null;
  closedAt: string | null;
  closedBy: number | null;
  closeReason: string | null;
  closureSummary: PlanningDayCycleSummary;
}

function withEmergencyResultContext(path: string, context: EmergencyResultContext): string {
  const query = new URLSearchParams({
    visitId: String(context.visitId),
    visitTaskId: String(context.visitTaskId),
  });
  return `${path}?${query.toString()}`;
}

// Read token from localStorage at call time (not at import time)
function getToken(): string | null {
  return localStorage.getItem('hr_token');
}

/**
 * The currently-selected branch context (if any), attached as X-Branch-Id.
 * Read from localStorage to avoid a circular import with the Zustand store.
 *
 * Set by the super-admin sidebar switcher AND by the per-page management filters
 * shown to GLOBAL-grant operators (e.g. مدير الشركة), whose sidebar switcher is
 * hidden. We attach it for any such user, not only super admins, so their
 * create/lookup calls scope to the picked branch. This is safe: the SERVER still
 * gates the target branch against the user's allowedBranchIds (resolveActingBranch
 * / resolveTargetBranchId), so a context outside the user's assignments is
 * rejected. Global-only admin pages are excluded (shouldAttachBranchContextHeader).
 */
function getBranchContextHeader(): string | null {
  try {
    if (!shouldAttachBranchContextHeader(window.location.pathname)) return null;
    const raw = localStorage.getItem('hr_branch_context');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? String(n) : null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Resolves the Mac-vs-iPad ambiguity the server cannot see (see
    // lib/deviceClass.ts). Sent on every call because the device policy is
    // enforced per request, not only at login.
    ...deviceClassHeader(),
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const branchCtx = getBranchContextHeader();
  if (branchCtx && !headers['X-Branch-Id']) headers['X-Branch-Id'] = branchCtx;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    // Token expired or invalid — clear session and redirect to login
    localStorage.removeItem('hr_token');
    localStorage.removeItem('hr_user');
    window.location.href = '/login';
    throw new Error('انتهت صلاحية الجلسة — يرجى تسجيل الدخول مرة أخرى');
  }

  if (res.status === 403) {
    // The device policy refuses this device. A session opened on a desktop
    // travels with the token, so this can land mid-session on any call — treat
    // it as "this device cannot hold a session": clear it and show the reason
    // on the login screen instead of an error toast on every page.
    const blocked = await readDeviceBlock(res);
    if (blocked) {
      localStorage.removeItem('hr_token');
      localStorage.removeItem('hr_user');
      sessionStorage.setItem(DEVICE_BLOCK_MESSAGE_KEY, blocked);
      window.location.href = '/login';
      throw new Error(blocked);
    }
  }

  if (!res.ok) {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      const err = new Error(parsed.error || parsed.message || `API Error ${res.status}`) as Error & {
        status?: number;
        payload?: unknown;
        response?: { status: number; data: unknown };
      };
      err.status = res.status;
      err.payload = parsed;
      err.response = { status: res.status, data: parsed };
      throw err;
    } catch (error) {
      if (error instanceof Error && !error.message.startsWith('Unexpected')) {
        throw error;
      }
      throw new Error(`API Error ${res.status}: ${text}`);
    }
  }
  return res.json();
}

type CatalogStateListOptions = {
  activeOnly?: boolean;
  includeInactive?: boolean;
};

type DeviceModelListOptions = CatalogStateListOptions & {
  branchId?: number | null;
};

function addCatalogStateParams(qs: URLSearchParams, options?: CatalogStateListOptions) {
  if (options?.activeOnly) qs.set('activeOnly', 'true');
  if (options?.includeInactive) qs.set('includeInactive', 'true');
}

function toQueryString(qs: URLSearchParams) {
  const value = qs.toString();
  return value ? `?${value}` : '';
}

export const api = {
  reports: {
    catalog: () => request<{ groups: ReportCatalogGroup[] }>('/reports/catalog'),
    filterOptions: (key: string, params?: Record<string, string | number | null | undefined>) => {
      const query = new URLSearchParams();
      Object.entries(params ?? {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
      });
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request<ReportFilterOptions>(`/reports/tabular/${key}/filter-options${suffix}`);
    },
    generateTabular: (key: string, filters?: Record<string, string | number | null | undefined>) =>
      request<TabularReportPendingResponse>(`/reports/tabular/${key}/generate`, { method: 'POST', body: JSON.stringify(filters ?? {}) }),
    tabularRun: (runId: string, params?: Record<string, string | number | null | undefined>) => {
      const query = new URLSearchParams();
      Object.entries(params ?? {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
      });
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request<TabularReportRunResponse>(`/reports/tabular/runs/${runId}${suffix}`);
    },
    exportTabularRun: async (runId: string) => {
      const response = await authFetch(`${API_BASE}/reports/tabular/runs/${runId}/export`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'فشل تصدير التقرير');
      }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `report-${runId}.xlsx`;
      return { blob: await response.blob(), filename, exportedAt: response.headers.get('X-Report-Exported-At') };
    },
    metric: (key: string, params?: Record<string, string | number | null | undefined>) => {
      const query = new URLSearchParams();
      Object.entries(params ?? {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
      });
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request<MetricResponse>(`/reports/${key}${suffix}`);
    },
    refresh: (key: string, params?: Record<string, string | number | null | undefined>) => {
      const query = new URLSearchParams();
      Object.entries(params ?? {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
      });
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request<MetricResponse>(`/reports/${key}/refresh${suffix}`, { method: 'POST' });
    },
    breakdown: (key: string, params?: Record<string, string | number | null | undefined>) => {
      const query = new URLSearchParams();
      Object.entries(params ?? {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
      });
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request<BreakdownResponse>(`/reports/breakdown/${key}${suffix}`);
    },
    refreshBreakdown: (key: string, params?: Record<string, string | number | null | undefined>) => {
      const query = new URLSearchParams();
      Object.entries(params ?? {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
      });
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request<BreakdownResponse>(`/reports/breakdown/${key}/refresh${suffix}`, { method: 'POST' });
    },
  },
  dashboardLayout: {
    get: () => request<{ layout: DashboardWidget[] }>('/me/dashboard-layout'),
    save: (layout: DashboardWidget[]) =>
      request<{ layout: DashboardWidget[] }>('/me/dashboard-layout', {
        method: 'PUT',
        body: JSON.stringify({ layout }),
      }),
  },
  gifts: {
    definitions: {
      list: () => request<any[]>('/gifts/definitions'),
      create: (data: any) => request<any>('/gifts/definitions', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: number | string, data: any) => request<any>(`/gifts/definitions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      delete: (id: number | string) => request<any>(`/gifts/definitions/${id}`, { method: 'DELETE' }),
    },
    records: {
      list: (params?: Record<string, string | number | null | undefined>) => {
        const query = new URLSearchParams();
        Object.entries(params ?? {}).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
        });
        const suffix = query.toString() ? `?${query.toString()}` : '';
        return request<import('../data/giftsPrototype').GiftRecordPrototype[]>(`/gifts/records${suffix}`);
      },
      similar: (data: any) =>
        request<{ count: number }>('/gifts/records/similar', { method: 'POST', body: JSON.stringify(data) }),
      create: async (data: any) => {
        try {
          return await request<any>('/gifts/records', { method: 'POST', body: JSON.stringify(data) });
        } catch (error: any) {
          if (error?.payload?.code !== 'similar_gift_promises') throw error;
          const count = Number(error.payload?.similarCount) || 0;
          const proceed = window.confirm(
            `تنبيه: يوجد ${count} وعد/وعود غير منتهية مشابهة لهذا المستفيد. لا يمنع ذلك إنشاء وعد جديد مستقل. هل تريد المتابعة؟`,
          );
          if (!proceed) throw new Error('تم إيقاف الحفظ بعد تنبيه الوعود المشابهة');
          return request<any>('/gifts/records', {
            method: 'POST',
            body: JSON.stringify({ ...data, similarPromiseWarningAcknowledged: true }),
          });
        }
      },
      updateReferralPromise: (id: number | string, data: { giftDefinitionId: number; conditionLabel: string; promisedQuantity: number }) =>
        request<any>(`/gifts/records/${id}/referral-promise`, { method: 'PATCH', body: JSON.stringify(data) }),
      updateCondition: (id: number | string, data: { conditionStatus: string; conditionNotes?: string }) =>
        request<any>(`/gifts/records/${id}/condition`, { method: 'PATCH', body: JSON.stringify(data) }),
      approve: (id: number | string, data?: { approvedQuantity?: number; approvalNotes?: string }) =>
        request<any>(`/gifts/records/${id}/approve`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
      withdrawApproval: (id: number | string, data: { reason: string }) =>
        request<any>(`/gifts/records/${id}/withdraw-approval`, { method: 'POST', body: JSON.stringify(data) }),
      createDeliveryTask: (id: number | string, data?: { giftRecordIds?: Array<number | string>; dueDate?: string; priority?: 'low' | 'medium' | 'high'; creationReason?: string; notes?: string }) =>
        request<any>(`/gifts/records/${id}/create-delivery-task`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
      manualDelivery: (id: number | string, data: { methodId: number; branchId: number; acknowledged: true; notes?: string }) =>
        request<any>(`/gifts/records/${id}/manual-delivery`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
      reopenManualDelivery: (id: number | string, data: { reason: string }) =>
        request<any>(`/gifts/records/${id}/reopen-manual-delivery`, { method: 'POST', body: JSON.stringify(data) }),
      cancel: (id: number | string, data?: { reason?: string }) =>
        request<any>(`/gifts/records/${id}/cancel`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
    },
  },
  geoUnits: {
    list: (branchId?: number | null) => request<any[]>(
      '/geo-units',
      branchId != null ? { headers: { 'X-Branch-Id': String(branchId) } } : undefined,
    ),
    listReference: () => request<any[]>('/geo-units/reference'),
    // Global name map for DISPLAY (address labels) — all units, no branch scope.
    // Use this to resolve an existing record's address; use `list(branchId)` for form pickers.
    names: () => request<any[]>('/geo-units/names'),
    create: (data: any) => request<any>('/geo-units', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: { name: string }) => request<any>(`/geo-units/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    updateStatus: (id: number, status: 'active' | 'inactive') => request<any>(`/geo-units/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    delete: (id: number) => request<any>(`/geo-units/${id}`, { method: 'DELETE' }),
  },
  branches: {
    list: () => request<any[]>('/branches'),
    get: (id: number) => request<any>(`/branches/${id}`),
    create: (data: any) => request<any>('/branches', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/branches/${id}`, { method: 'DELETE' }),
  },
  admin: {
    hrUsers: {
      list: () => request<any[]>('/admin/hr-users'),
      assignable: () => request<any[]>('/admin/hr-users/assignable'),
      nameListAssignable: (branchId?: number | null) => request<any[]>(
        `/admin/hr-users/name-list-assignable${branchId != null ? `?branchId=${branchId}` : ''}`,
      ),
      candidateAssignable: (branchId?: number | null) => request<any[]>(
        `/admin/hr-users/candidate-assignable${branchId != null ? `?branchId=${branchId}` : ''}`,
      ),
    },
    taskTypes: {
      list: (activeOnly = false) => {
        const qs = activeOnly ? '?activeOnly=true' : '';
        return request<TaskTypeConfig[]>(`/admin/task-types${qs}`);
      },
      update: (taskType: string, data: { planningWindowDays?: number | null; isActive?: boolean }) =>
        request<TaskTypeConfig>(`/admin/task-types/${encodeURIComponent(taskType)}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
    },
    emergencyActionTypes: {
      list:   () => request<any[]>('/admin/emergency-action-types'),
      active: () => request<any[]>('/admin/emergency-action-types/active'),
      create: (data: { arabicLabel: string; description?: string; displayOrder?: number }) =>
        request<any>('/admin/emergency-action-types', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: number, data: { arabicLabel?: string; description?: string; displayOrder?: number; isActive?: boolean }) =>
        request<any>(`/admin/emergency-action-types/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      delete: (id: number) => request<any>(`/admin/emergency-action-types/${id}`, { method: 'DELETE' }),
    },
    // Mobile home-screen slider. Targets are deliberately narrow: a banner is
    // shown to every app user (visitors included), so a device target is a
    // public-catalog device_models id, never a customer's installed device.
    appHomeBanners: {
      list: () => request<AppHomeBanner[]>('/admin/app-home-banners'),
      targetOptions: () => request<AppHomeBannerTargetOptions>('/admin/app-home-banners/target-options'),
      create: (data: AppHomeBannerInput) =>
        request<AppHomeBanner>('/admin/app-home-banners', { method: 'POST', body: JSON.stringify(data) }),
      // Full replace, not a patch: the target is one coherent shape (kind plus
      // exactly one value), so the server validates the whole row at once.
      update: (id: number, data: AppHomeBannerInput) =>
        request<AppHomeBanner>(`/admin/app-home-banners/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      reorder: (ids: number[]) =>
        request<AppHomeBanner[]>('/admin/app-home-banners/reorder', { method: 'PATCH', body: JSON.stringify({ ids }) }),
      delete: (id: number) => request<{ success: true }>(`/admin/app-home-banners/${id}`, { method: 'DELETE' }),
    },
    // Free-form customer notification (DEC-019 D-N6). `audiencePreview` is not
    // optional politeness: a send is irreversible and leaves the system, so the
    // count the operator confirms against comes from the same predicate the
    // send itself uses.
    appNotifications: {
      audiencePreview: (audience: BroadcastAudienceInput) =>
        request<BroadcastAudiencePreview>('/admin/app-notifications/audience-preview', {
          method: 'POST',
          body: JSON.stringify(audience),
        }),
      send: (data: BroadcastInput) =>
        request<{ broadcastId: string; notificationCount: number; pushed: number }>(
          '/admin/app-notifications/broadcasts',
          { method: 'POST', body: JSON.stringify(data) },
        ),
      history: () => request<{ items: BroadcastRecord[] }>('/admin/app-notifications/broadcasts'),
      // Options for the intake-form destination, whose id is a request_type slug.
      requestTypes: () => request<{ items: { requestType: string; labelAr: string }[] }>(
        '/admin/app-notifications/request-types',
      ),
    },
    appContactLinks: {
      get: () => request<AppContactLinks>('/admin/app-contact-links'),
      update: (data: AppContactLinksInput) =>
        request<AppContactLinks>('/admin/app-contact-links', {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
    },
  },
  employees: {
    list: (branchId?: number | null) => request<any[]>(
      '/employees',
      branchId != null ? { headers: { 'X-Branch-Id': String(branchId) } } : undefined,
    ),
    lookup: (branchId?: number | null) => {
      const query = branchId != null ? `?branchId=${encodeURIComponent(String(branchId))}` : '';
      return request<any[]>(`/employees/lookup${query}`);
    },
    schedulePool: () => request<any[]>('/employees/schedule-pool'),
    closers: () => request<any[]>('/employees/closers'),
    employeeClosers: () => request<any[]>('/employees/closers?target=employee'),
    get: (id: number) => request<any>(`/employees/${id}`),
    create: (data: any) => request<any>('/employees', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    managerCandidates: (branchId: number, departmentId?: number) => {
      const query = new URLSearchParams({ branchId: String(branchId) });
      if (departmentId != null) query.set('departmentId', String(departmentId));
      return request<any[]>(`/employees/manager-candidates?${query.toString()}`);
    },
    upsertSystemAccount: (id: number, data: any) => request<any>(`/employees/${id}/system-account`, { method: 'PUT', body: JSON.stringify(data) }),
    transferBranch: (id: number, data: { toBranchId: number; note?: string | null }) =>
      request<{ employeeId: number; fromBranchId: number | null; toBranchId: number; movedAccounts: number }>(
        `/employees/${id}/transfer-branch`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    delete: (id: number) => request<any>(`/employees/${id}`, { method: 'DELETE' }),
  },
  clients: {
    // branchId narrows a GLOBAL viewer to one branch (sent as X-Branch-Id, the
    // header the list endpoint reads); null/undefined lets the server scope.
    list: (branchId?: number | null) => request<any[]>(
      '/clients',
      branchId != null ? { headers: { 'X-Branch-Id': String(branchId) } } : undefined,
    ),
    // Paginated + server-filtered list — used only by the Clients records page.
    // list() above stays the full-list source for the ~15 picker/matching callers.
    // Filter values of 'all'/''/null are dropped so callers can pass UI state as-is.
    listPaged: (params: PagedClientsParams = {}) => {
      const { branchId, ...rest } = params;
      const query = new URLSearchParams();
      Object.entries(rest).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '' && value !== 'all') {
          query.set(key, String(value));
        }
      });
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return request<PagedClientsResponse>(
        `/clients/paged${suffix}`,
        branchId != null ? { headers: { 'X-Branch-Id': String(branchId) } } : undefined,
      );
    },
    get: (id: number) => request<any>(`/clients/${id}`),
    snapshot: (id: number) => request<{ snapshot: any }>(`/clients/${id}/snapshot`),
    listServiceRequests: (id: number) => request<{ items: any[] }>(`/clients/${id}/service-requests`),
    getNetwork: (id: number) => request<any>(`/clients/${id}/network`),
    getRatingHistory: (id: number) => request<any[]>(`/clients/${id}/rating-history`),
    updateRating: (id: number, data: { rating: 'Committed' | 'NotCommitted' | 'Undefined'; notes?: string | null }) =>
      request<any>(`/clients/${id}/rating-history`, { method: 'POST', body: JSON.stringify(data) }),
    getAccountStatement: (
      id: number,
      params?: { from?: string; to?: string; types?: string },
    ) => {
      const query = new URLSearchParams();
      if (params?.from) query.set('from', params.from);
      if (params?.to) query.set('to', params.to);
      if (params?.types) query.set('types', params.types);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return request<AccountStatementResponse>(`/clients/${id}/account-statement${suffix}`);
    },
    smartMatch: (data: { phone?: string; mobile?: string; name?: string; branchId?: number }) =>
      request<any>('/clients/smart-match', { method: 'POST', body: JSON.stringify(data) }),
    create: (data: any) => request<any>('/clients', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/clients/${id}`, { method: 'DELETE' }),
    // DEC-005 D29 + DEC-006 D32: contact-control surface
    setCooldown: (id: number, data: { days: number; reason: string }) =>
      request<any>(`/clients/${id}/cooldown`, { method: 'POST', body: JSON.stringify(data) }),
    clearCooldown: (id: number) =>
      request<any>(`/clients/${id}/cooldown`, { method: 'DELETE' }),
    setDoNotContact: (id: number, doNotContact: boolean, reason: string) =>
      request<any>(`/clients/${id}/do-not-contact`, {
        method: 'PATCH',
        body: JSON.stringify({ doNotContact, reason }),
      }),
  },
  customers: {
    getPurchaseHistory: (customerId: number) =>
      request<any>(`/customers/${customerId}/purchase-history`),
    getPartsStock: (customerId: number) =>
      request<any>(`/customers/${customerId}/parts-stock`),
    // Pre-offers tab — every device-demo pre-offer with its outcome.
    getPreOffers: (customerId: number) =>
      request<{ customerId: number; entries: any[]; summary: any }>(`/customers/${customerId}/pre-offers`),
    createPreOffers: (customerId: number, data: { branchId?: number | null; offers: any[] }) =>
      request<{ success: boolean; created: Array<{ id: number }> }>(`/customers/${customerId}/pre-offers`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  customerCalls: {
    list: (customerId: number) => request<any[]>(`/customers/${customerId}/calls`),
    listByContact: (customerId: number, contactId: string) =>
      request<any[]>(`/customers/${customerId}/calls?contactId=${encodeURIComponent(contactId)}`),
    stats: (customerId: number) => request<any[]>(`/customers/${customerId}/calls/stats`),
    create: (customerId: number, data: any) =>
      request<any>(`/customers/${customerId}/calls`, { method: 'POST', body: JSON.stringify(data) }),
    update: (callId: string, data: any) =>
      request<any>(`/customers/calls/${callId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  candidates: {
    // branchId narrows a GLOBAL viewer to one branch (X-Branch-Id); null lets the server scope.
    list: (branchId?: number | null) => request<any[]>(
      '/candidates',
      branchId != null ? { headers: { 'X-Branch-Id': String(branchId) } } : undefined,
    ),
    // Server-paginated records surface. Added BESIDE `list` — every existing
    // consumer of `list` keeps the exact endpoint and shape it had.
    listPaged: (params: PagedCandidatesParams = {}) => {
      const { branchId, ...rest } = params;
      const query = new URLSearchParams();
      Object.entries(rest).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '' && value !== 'all') {
          query.set(key, String(value));
        }
      });
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return request<PagedCandidatesResponse>(
        `/candidates/paged${suffix}`,
        branchId != null ? { headers: { 'X-Branch-Id': String(branchId) } } : undefined,
      );
    },
    get: (id: number) => request<import('@golden-crm/shared').CandidateDetail>(`/candidates/${id}`),
    create: async (data: any) => {
      try {
        return await request<any>('/candidates', { method: 'POST', body: JSON.stringify(data) });
      } catch (error: any) {
        if (error?.payload?.code !== 'similar_gift_promises' || !data?.giftPromise) throw error;
        const count = Number(error.payload?.similarCount) || 0;
        const proceed = window.confirm(
          `تنبيه: يوجد ${count} وعد/وعود غير منتهية مشابهة لهذا الوسيط. هل تريد حفظ الاسم ووعد جديد مستقل؟`,
        );
        if (!proceed) throw new Error('تم إيقاف الحفظ بعد تنبيه الوعود المشابهة');
        return request<any>('/candidates', {
          method: 'POST',
          body: JSON.stringify({
            ...data,
            giftPromise: { ...data.giftPromise, similarPromiseWarningAcknowledged: true },
          }),
        });
      }
    },
    update: (id: number, data: any) => request<any>(`/candidates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    linkToClient: (id: number, clientId: number) =>
      request<any>(`/candidates/${id}/link-client`, { method: 'POST', body: JSON.stringify({ clientId }) }),
    delete: (id: number) => request<any>(`/candidates/${id}`, { method: 'DELETE' }),
  },
  referralSheets: {
    // branchId narrows a GLOBAL viewer to one branch (X-Branch-Id); null lets the server scope.
    list: (branchId?: number | null) => request<any[]>(
      '/referral-sheets',
      branchId != null ? { headers: { 'X-Branch-Id': String(branchId) } } : undefined,
    ),
    create: async (data: any) => {
      try {
        return await request<any>('/referral-sheets', { method: 'POST', body: JSON.stringify(data) });
      } catch (error: any) {
        if (error?.payload?.code !== 'similar_gift_promises' || !data?.giftPromise) throw error;
        const count = Number(error.payload?.similarCount) || 0;
        const proceed = window.confirm(
          `تنبيه: يوجد ${count} وعد/وعود غير منتهية مشابهة لهذا الوسيط. هل تريد حفظ اللائحة ووعد جديد مستقل؟`,
        );
        if (!proceed) throw new Error('تم إيقاف الحفظ بعد تنبيه الوعود المشابهة');
        return request<any>('/referral-sheets', {
          method: 'POST',
          body: JSON.stringify({
            ...data,
            giftPromise: { ...data.giftPromise, similarPromiseWarningAcknowledged: true },
          }),
        });
      }
    },
    update: (id: number, data: any) => request<any>(`/referral-sheets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  routes: {
    list: () => request<any[]>('/routes'),
    create: (data: any) => request<any>('/routes', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/routes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/routes/${id}`, { method: 'DELETE' }),
  },
  // Legacy `tasks` wrapper removed 2026-06-10 — the old monolithic `tasks`
  // table is being retired in favour of `open_tasks` + `visit_tasks`. Pages
  // that consumed `api.tasks.list()` (TodaysTasks/Periodic/Returns/FollowUp)
  // were deleted in the same change. Use `api.openTasks` for current work.

  contracts: {
    // branchId narrows a GLOBAL viewer to one branch (X-Branch-Id); null lets
    // the server scope by the user's grants (BRANCH/ASSIGNED are server-scoped).
    list: (params?: { customerId?: number; branchId?: number | null }) => {
      const qs = params?.customerId ? `?customerId=${params.customerId}` : '';
      return request<any[]>(
        `/contracts${qs}`,
        params?.branchId != null ? { headers: { 'X-Branch-Id': String(params.branchId) } } : undefined,
      );
    },
    // Paginated + server-filtered list — used only by the contracts records page.
    // list() above stays the full-list source for its other callers.
    listPaged: (params: PagedContractsParams = {}) => {
      const { branchId, ...rest } = params;
      const query = new URLSearchParams();
      Object.entries(rest).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '' && value !== 'all') {
          query.set(key, String(value));
        }
      });
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return request<PagedContractsResponse>(
        `/contracts/paged${suffix}`,
        branchId != null ? { headers: { 'X-Branch-Id': String(branchId) } } : undefined,
      );
    },
    get: (id: number) => request<any>(`/contracts/${id}`),
    create: (data: any) => request<any>('/contracts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/contracts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/contracts/${id}`, { method: 'DELETE' }),
    savePaymentEntries: (contractId: number, entries: any[]) =>
      request<any>(`/contracts/${contractId}/payment-entries`, { method: 'POST', body: JSON.stringify({ entries }) }),
    saveInstallments: (contractId: number, installments: any[]) =>
      request<any>(`/contracts/${contractId}/installments`, { method: 'POST', body: JSON.stringify({ installments }) }),
    confirmInstallments: (contractId: number) =>
      request<any>(`/contracts/${contractId}/installments/confirm`, { method: 'POST' }),
    toggleLineItemInstallation: (contractId: number, itemId: number, isInstalled: boolean) =>
      request<any>(`/contracts/${contractId}/line-items/${itemId}/installation`, {
        method: 'PUT',
        body: JSON.stringify({ isInstalled }),
      }),
    // DEC-CT-01 follow-up: approve / reject the draft → terminal transitions.
    approve: (contractId: number, body?: { closingEmployeeId?: number }) =>
      request<any>(`/contracts/${contractId}/approve`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),
    reject: (contractId: number, body?: { reason?: string }) =>
      request<any>(`/contracts/${contractId}/reject`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),
    cancel: (contractId: number, body?: { reason?: string; reasonCode?: string }) =>
      request<any>(`/contracts/${contractId}/cancel`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),
    // DEC-CT-14/15: fetch the legal printable HTML with the auth header
    // attached. Returns the raw HTML; callers turn it into a Blob URL so
    // it can be opened in a new tab without exposing the JWT.
    getPrintableHtml: async (contractId: number): Promise<string> => {
      const res = await authFetch(`${API_BASE}/contracts/${contractId}/printable`);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`فشل تحميل النسخة القانونية (${res.status}): ${text}`);
      }
      return res.text();
    },
  },
  dues: {
    list: () => request<any[]>('/dues'),
    update: (id: number, data: any) => request<any>(`/dues/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  deviceParts: {
    list: (deviceId: number) => request<any[]>(`/device-parts?deviceId=${deviceId}`),
  },
  deviceWarranties: {
    list: (deviceId: number) => request<any[]>(`/device-warranties?deviceId=${deviceId}`),
    eligibleForCardDelivery: (customerId: number, branchId?: number | null) => {
      const qs = new URLSearchParams({ customerId: String(customerId) });
      if (branchId) qs.set('branchId', String(branchId));
      return request<any[]>(`/device-warranties/golden/card-delivery-eligible?${qs}`);
    },
    update: (id: number, data: any) => request<any>(`/device-warranties/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    // DEC-CT-17 golden-warranty flows
    offerResult: (data: any) => request<any>(`/device-warranties/golden/offer-result`, { method: 'POST', body: JSON.stringify(data) }),
    payments: (warrantyId: number) => request<any>(`/device-warranties/${warrantyId}/payments`),
    addPayment: (warrantyId: number, data: any) => request<any>(`/device-warranties/${warrantyId}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  },
  installedDevices: {
    list: (params?: { customerId?: number; branchId?: number; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.customerId) qs.set('customerId', String(params.customerId));
      if (params?.branchId)   qs.set('branchId', String(params.branchId));
      if (params?.status)     qs.set('status', params.status);
      return request<any[]>(`/installed-devices?${qs}`);
    },
    listPaged: (params: PagedInstalledDevicesParams = {}) => {
      const { branchId, ...rest } = params;
      const query = new URLSearchParams();
      Object.entries(rest).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '' && value !== 'all') {
          query.set(key, String(value));
        }
      });
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return request<PagedInstalledDevicesResponse>(
        `/installed-devices/paged${suffix}`,
        branchId != null ? { headers: { 'X-Branch-Id': String(branchId) } } : undefined,
      );
    },
    get: (id: number) => request<any>(`/installed-devices/${id}`),
    deliverySuspensionHistory: (id: number) => request<any[]>(`/installed-devices/${id}/delivery-suspension-history`),
    suspendDelivery: (id: number, notes: string) => request<any>(`/installed-devices/${id}/suspend-delivery`, { method: 'POST', body: JSON.stringify({ notes }) }),
    resumeDelivery: (id: number, notes: string) => request<any>(`/installed-devices/${id}/resume-delivery`, { method: 'POST', body: JSON.stringify({ notes }) }),
    createExternal: (data: any) => request<any>('/installed-devices/external', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/installed-devices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    createPeriodicMaintenance: (id: number, data: any) =>
      request<any>(`/installed-devices/${id}/periodic-maintenance`, { method: 'POST', body: JSON.stringify(data) }),
    problems: (id: number) => request<any[]>(`/installed-devices/${id}/problems`),
    technicalStates: (id: number) => request<any[]>(`/installed-devices/${id}/technical-states`),
  },
  serviceAgreements: {
    list: (params?: { installedDeviceId?: number; branchId?: number }) => {
      const qs = new URLSearchParams();
      if (params?.installedDeviceId) qs.set('installedDeviceId', String(params.installedDeviceId));
      if (params?.branchId) qs.set('branchId', String(params.branchId));
      return request<any[]>(`/service-agreements${toQueryString(qs)}`);
    },
    get: (id: number) => request<any>(`/service-agreements/${id}`),
    create: (data: any) => request<any>('/service-agreements', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/service-agreements/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  // DEC-CT-09: device possession ledger.
  // Backend route is mounted at /api/devices/:deviceId/possession.
  devicePossession: {
    list:     (deviceId: number) => request<DevicePossessionEntry[]>(`/devices/${deviceId}/possession`),
    current:  (deviceId: number) => request<DevicePossessionEntry | null>(`/devices/${deviceId}/possession/current`),
    transfer: (deviceId: number, data: { holderType: string; holderId?: number | null; reason: string; notes?: string; transferAt?: string }) =>
      request<DevicePossessionEntry>(`/devices/${deviceId}/possession`, { method: 'POST', body: JSON.stringify(data) }),
  },
  deviceModels: {
    list: (params?: number | DeviceModelListOptions) => {
      const options: DeviceModelListOptions =
        typeof params === 'number' ? { branchId: params } : (params ?? {});
      const qs = new URLSearchParams();
      if (options.branchId != null) qs.set('branchId', String(options.branchId));
      addCatalogStateParams(qs, options);
      return request<any[]>(`/device-models${toQueryString(qs)}`);
    },
    create: (data: any) => request<any>('/device-models', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/device-models/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/device-models/${id}`, { method: 'DELETE' }),
    getSalesBranches: (id: number) => request<{
      deviceModelId: number;
      branches: Array<{ id: number; name: string; detailedAddress: string | null; locationGeoName: string | null; isSelected: boolean }>;
    }>(`/device-models/${id}/sales-branches`),
    updateSalesBranches: (id: number, branchIds: number[]) => request<{
      deviceModelId: number;
      branches: Array<{ id: number; name: string; detailedAddress: string | null; locationGeoName: string | null; isSelected: boolean }>;
    }>(`/device-models/${id}/sales-branches`, { method: 'PUT', body: JSON.stringify({ branchIds }) }),
    getDiscounts: (deviceModelId: number) => request<any[]>(`/device-models/${deviceModelId}/discounts`),
    getAllDiscounts: (deviceModelId: number) => request<any[]>(`/device-models/${deviceModelId}/discounts/all`),
    createDiscount: (deviceModelId: number, data: any) => request<any>(`/device-models/${deviceModelId}/discounts`, { method: 'POST', body: JSON.stringify(data) }),
    updateDiscount: (deviceModelId: number, discountId: number, data: any) => request<any>(`/device-models/${deviceModelId}/discounts/${discountId}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteDiscount: (deviceModelId: number, discountId: number) => request<any>(`/device-models/${deviceModelId}/discounts/${discountId}`, { method: 'DELETE' }),
    getPrices: (deviceModelId: number) => request<any[]>(`/device-models/${deviceModelId}/prices`),
    createPrice: (deviceModelId: number, data: any) => request<any>(`/device-models/${deviceModelId}/prices`, { method: 'POST', body: JSON.stringify(data) }),
  },
  spareParts: {
    list: (options?: CatalogStateListOptions) => {
      const qs = new URLSearchParams();
      addCatalogStateParams(qs, options);
      return request<any[]>(`/spare-parts${toQueryString(qs)}`);
    },
    create: (data: any) => request<any>('/spare-parts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/spare-parts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/spare-parts/${id}`, { method: 'DELETE' }),
    getPrices: (id: number) => request<any[]>(`/spare-parts/${id}/prices`),
    createPrice: (id: number, data: any) => request<any>(`/spare-parts/${id}/prices`, { method: 'POST', body: JSON.stringify(data) }),
  },
  maintenanceRequests: {
    list: () => request<any[]>('/maintenance-requests'),
    create: (data: any) => request<any>('/maintenance-requests', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/maintenance-requests/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  emergencyResult: {
    get:          (taskId: number)            => request<any>(`/emergency-result/${taskId}`),
    savePreState: (taskId: number, data: any, context: EmergencyResultContext) => request<any>(withEmergencyResultContext(`/emergency-result/${taskId}/pre-state`, context),  { method: 'PUT', body: JSON.stringify(data) }),
    saveActions:  (taskId: number, data: any, context: EmergencyResultContext) => request<any>(withEmergencyResultContext(`/emergency-result/${taskId}/actions`, context),    { method: 'PUT', body: JSON.stringify(data) }),
    savePostState:(taskId: number, data: any, context: EmergencyResultContext) => request<any>(withEmergencyResultContext(`/emergency-result/${taskId}/post-state`, context), { method: 'PUT', body: JSON.stringify(data) }),
    saveCosts:    (taskId: number, data: any, context: EmergencyResultContext) => request<any>(withEmergencyResultContext(`/emergency-result/${taskId}/costs`, context),      { method: 'PUT', body: JSON.stringify(data) }),
    saveParts:          (taskId: number, parts: any[], context: EmergencyResultContext) => request<any[]>(withEmergencyResultContext(`/emergency-result/${taskId}/parts`, context), { method: 'PUT', body: JSON.stringify({ parts }) }),
    getParts:           (taskId: number)              => request<any[]>(`/emergency-result/${taskId}/parts`),
    deviceHistory:      (contractId: number)          => request<any[]>(`/emergency-result/device/${contractId}/history`),
    getPaymentEntries:  (taskId: number)              => request<any[]>(`/emergency-result/${taskId}/payment-entries`),
    savePaymentEntries: (taskId: number, entries: any[], context: EmergencyResultContext) => request<any>(withEmergencyResultContext(`/emergency-result/${taskId}/payment-entries`, context), { method: 'PUT', body: JSON.stringify({ entries }) }),
    getInstallments:    (taskId: number)              => request<any>(`/emergency-result/${taskId}/installments`),
    saveInstallments:   (taskId: number, data: any, context: EmergencyResultContext) => request<any>(withEmergencyResultContext(`/emergency-result/${taskId}/installments`, context), { method: 'PUT', body: JSON.stringify(data) }),
    confirmInstallments:(taskId: number, context: EmergencyResultContext) => request<any>(withEmergencyResultContext(`/emergency-result/${taskId}/installments/confirm`, context), { method: 'POST' }),
  },
  emergencyTickets: {
    list: (params?: { openTaskId?: number }) => {
      const qs = params?.openTaskId ? `?openTaskId=${params.openTaskId}` : '';
      return request<any[]>(`/emergency-tickets${qs}`);
    },
    create: (data: any) => request<any>('/emergency-tickets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/emergency-tickets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  openTasks: {
    create: (data: any) => request<any>('/open-tasks', { method: 'POST', body: JSON.stringify(data) }),
    listByClient: (clientId: number) => request<any[]>(`/open-tasks/client/${clientId}`),
    listByDevice: (deviceId: number) => request<any[]>(`/open-tasks/device/${deviceId}`),
    collectableInstallments: (clientId: number) => request<any[]>(`/open-tasks/client/${clientId}/collectable-installments`),
    get: (id: number) => request<any>(`/open-tasks/${id}`),
    update: (id: number, data: any) => request<any>(`/open-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    cancel: (id: number, reasonId: number) =>
      request<{ task: any; cancellationReason: { id: number; category: string; value: string; label: string } }>(
        `/open-tasks/${id}/cancel`,
        { method: 'POST', body: JSON.stringify({ reasonId }) },
      ),
    assignTeam: (id: number, data: { supervisorId?: number; technicianId?: number; traineeId?: number }) =>
      request<any>(`/open-tasks/${id}/assign-team`, { method: 'POST', body: JSON.stringify(data) }),
    /** DEC-004 D22: book a field_visit from a needs_follow_up task using its expected_date. */
    scheduleFromExpected: (id: number, data: {
      date?: string;
      timeSlot?: string;
      teamKey: string;
      notes?: string | null;
      telemarketerNotes?: string | null;
      fieldInstructions?: string | null;
      taskListId?: string;
      taskListItemId?: string;
      taskListItemIds?: string[];
      contactTargetId?: number | null;
      selectedOpenTasks?: Array<{ openTaskId: number; taskType: string }>;
      customerSnapshot?: Record<string, unknown> | null;
    }) => request<{ fieldVisitId: number; visitTaskIds: number[]; contactTargetId: number | null }>(
      `/open-tasks/${id}/schedule-from-expected`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
    /** DEC-006 D37: open tasks whose attempt_count crossed system_settings.attempt_alert_threshold. */
    attemptAlerts: () => request<{
      threshold: number;
      count: number;
      items: Array<{
        openTaskId: number;
        clientId: number;
        clientName: string;
        clientMobile: string | null;
        taskType: string;
        taskFamily: string;
        status: string;
        attemptCount: number;
        lastAttemptAt: string | null;
        creationOrigin: string | null;
        assignedTeamKey: string | null;
        assignedForDate: string | null;
      }>;
    }>('/open-tasks/attempt-alerts'),
    getEmergencyResult: (id: number) => request<any>(`/open-tasks/${id}/emergency-result`),
    listDeviceDemo: (params: { branchId?: number; status?: string; visitStatus?: string; scheduledDate?: string; scheduled?: 'yes' | 'no'; hideSnoozed?: 'true'; hideFutureTasks?: 'true' }) => {
      const q = new URLSearchParams();
      if (params.branchId) q.set('branchId', String(params.branchId));
      if (params.status) q.set('status', params.status);
      if (params.visitStatus) q.set('visitStatus', params.visitStatus);
      if (params.scheduledDate) q.set('scheduledDate', params.scheduledDate);
      if (params.scheduled) q.set('scheduled', params.scheduled);
      if (params.hideSnoozed) q.set('hideSnoozed', params.hideSnoozed);
      if (params.hideFutureTasks) q.set('hideFutureTasks', params.hideFutureTasks);
      return request<any[]>(`/open-tasks/device-demo?${q}`);
    },
    listByGroup: (groupKey: string, params: { branchId?: number; status?: string; visitStatus?: string; scheduledDate?: string; scheduled?: 'yes' | 'no'; hideSnoozed?: 'true'; hideFutureTasks?: 'true' }) => {
      const q = new URLSearchParams();
      if (params.branchId) q.set('branchId', String(params.branchId));
      if (params.status) q.set('status', params.status);
      if (params.visitStatus) q.set('visitStatus', params.visitStatus);
      if (params.scheduledDate) q.set('scheduledDate', params.scheduledDate);
      if (params.scheduled) q.set('scheduled', params.scheduled);
      if (params.hideSnoozed) q.set('hideSnoozed', params.hideSnoozed);
      if (params.hideFutureTasks) q.set('hideFutureTasks', params.hideFutureTasks);
      return request<any[]>(`/open-tasks/group/${encodeURIComponent(groupKey)}?${q}`);
    },
    // ASSIGNED-scope "my customers' tasks" — all task types for customers the user
    // personally owns (server gates by ownership). Only status/taskType filters apply.
    listMyCustomers: (params: { status?: string; taskType?: string } = {}) => {
      const q = new URLSearchParams();
      if (params.status) q.set('status', params.status);
      if (params.taskType) q.set('taskType', params.taskType);
      return request<any[]>(`/open-tasks/my-customers?${q}`);
    },
    getActivity: (id: number) => request<any[]>(`/open-tasks/${id}/activity`),
    addActivity: (id: number, data: any) => request<any>(`/open-tasks/${id}/activity`, { method: 'POST', body: JSON.stringify(data) }),
    getDevices: (id: number) => request<any[]>(`/open-tasks/${id}/devices`),
    getInstalledDevices: (id: number) => request<any[]>(`/open-tasks/${id}/installed-devices`),
    addDevices: (id: number, data: any) => request<any>(`/open-tasks/${id}/devices`, { method: 'POST', body: JSON.stringify(data) }),
    getCalls: (id: number) => request<any[]>(`/open-tasks/${id}/calls`),
    /** سياق المهمة: سلسلة محاولات التنفيذ (visit_tasks) تحت هذه المهمة. */
    getAttempts: (id: number) => request<{ taskStatus: string; attempts: any[] }>(`/open-tasks/${id}/attempts`),
    exclude: (id: number, reason?: string) =>
      request<any>(`/open-tasks/${id}/exclude`, { method: 'POST', body: JSON.stringify({ reason: reason ?? null }) }),
    restore: (id: number) =>
      request<any>(`/open-tasks/${id}/restore`, { method: 'POST', body: JSON.stringify({}) }),
    bulkExclude: (taskIds: number[], reason?: string) =>
      request<{ updated: number }>('/open-tasks/bulk-exclude', { method: 'POST', body: JSON.stringify({ taskIds, reason: reason ?? null }) }),
    bulkRestore: (taskIds: number[]) =>
      request<{ updated: number }>('/open-tasks/bulk-restore', { method: 'POST', body: JSON.stringify({ taskIds }) }),
  },
  contactTargets: {
    manualClose: (taskListId: string, itemId: string, data: { reason?: string; expectedDate?: string; priority?: string }) =>
      request<{ success: boolean }>(`/telemarketing/task-lists/${encodeURIComponent(taskListId)}/items/${encodeURIComponent(itemId)}/close`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    // DEC-005 D26: manual close of a contact_target with optional cooldown activation
    close: (contactTargetId: number, data: {
      closingReason?: string;
      activateCooldown?: boolean;
      cooldownReason?: string;
      cooldownDays?: number;
    }) => request<{ contactTarget: any; cooldown: any | null }>(`/contact-targets/${contactTargetId}/close`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  },
  // Legacy `visits` wrapper removed 2026-06-10 — replaced by `fieldVisits`
  // (multi-stakeholder visits, FK-enforced, integer IDs). The single
  // consumer (TelemarketerWorkspace timeline) was migrated to
  // `api.fieldVisits.list({ clientId })` in the same change.

  schedules: {
    get: (date: string) => request<any>(`/schedules/${date}`),
    save: (date: string, data: any) => request<any>(`/schedules/${date}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  routeAssignments: {
    list: () => request<Record<string, any>>('/route-assignments'),
    get: (key: string) => request<any>(`/route-assignments/${key}`),
    save: (key: string, data: any) => request<any>(`/route-assignments/${key}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  planning: {
    curationDashboard: (params: {
      date: string;
      teamKey: string;
      filters?: PlanningDashboardFilters;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
    }) => {
      const query = new URLSearchParams({
        date: params.date,
        teamKey: params.teamKey,
        page: String(params.page ?? 1),
        limit: String(params.limit ?? 50),
        sortBy: params.sortBy ?? 'clientName',
        sortDir: params.sortDir ?? 'asc',
      });
      if (params.filters && Object.keys(params.filters).length > 0) {
        query.set('filters', JSON.stringify(params.filters));
      }
      return request<PlanningCurationDashboardResponse>(
        `/planning/contact-targets-dashboard/curation?${query.toString()}`,
      );
    },
    previewCuration: (data: {
      date: string;
      teamKey: string;
      action: PlanningCurationAction;
      layer: PlanningExclusionLayer;
      selector: PlanningCurationSelector;
      reasonCode?: string;
      reasonText?: string;
    }) => request<{
      previewToken: string;
      expiresAt: string;
      canApply: boolean;
      counts: {
        contacts: number;
        selectedTasks: number;
        affectedTasks: number;
        releasedAssignments: number;
        closedTargets: number;
        contactsFullyExcluded: number;
        alreadyApplied: number;
        committedConflicts: number;
        skippedUnavailableTasks: number;
      };
      warnings: string[];
      sample: Array<{
        rowKey: string;
        clientId: number;
        clientName: string;
        taskCount: number;
        selectedTaskCount: number;
      }>;
    }>('/planning/contact-targets-dashboard/curation/preview', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    applyCuration: (previewToken: string) => request<{
      operationId: number;
      changedTasks: number;
      changedClients: number;
      releasedAssignments: number;
    }>('/planning/contact-targets-dashboard/curation/apply', {
      method: 'POST',
      body: JSON.stringify({ previewToken }),
    }),
    assignedTasks: (date: string, teamKey: string) => {
      const query = new URLSearchParams({ date, teamKey });
      return request<any>(`/planning/assigned-tasks?${query.toString()}`);
    },
    contactTargetsDashboard: (date: string, teamKey: string) => {
      const query = new URLSearchParams({ date, teamKey });
      return request<any>(`/planning/contact-targets-dashboard?${query.toString()}`);
    },
    syncContactTargetsDashboard: (date: string, teamKey: string) =>
      request<any>('/planning/contact-targets-dashboard/sync', {
        method: 'POST',
        body: JSON.stringify({ date, teamKey }),
      }),
    previewClosePlanningDay: (date: string, teamKey: string) =>
      request<{ cycle: PlanningDayCycle; summary: PlanningDayCycleSummary }>(
        '/planning/contact-targets-dashboard/close/preview',
        { method: 'POST', body: JSON.stringify({ date, teamKey }) },
      ),
    closePlanningDay: (date: string, teamKey: string) =>
      request<{
        date: string;
        teamKey: string;
        alreadyClosed: boolean;
        summary: PlanningDayCycleSummary;
      }>('/planning/contact-targets-dashboard/close', {
        method: 'POST',
        body: JSON.stringify({ date, teamKey }),
      }),
    marketingTargets: (date: string, teamKey: string, mode: 'planning' | 'assigned' = 'planning') => {
      const query = new URLSearchParams({ date, teamKey, mode });
      return request<any>(`/planning/marketing-targets?${query.toString()}`);
    },
  },
  zoneStudy: {
    get: (date: string, mode: ZoneStudyMode) => {
      const query = new URLSearchParams({ date, mode });
      return request<ZoneStudyResponse>(`/planning/zone-study?${query.toString()}`);
    },
    refresh: (date: string, mode: ZoneStudyMode) => {
      const query = new URLSearchParams({ date, mode });
      return request<ZoneStudyResponse>(`/planning/zone-study/refresh?${query.toString()}`, {
        method: 'POST',
      });
    },
    pick: (date: string, zoneId: number) => {
      const query = new URLSearchParams({ date });
      return request<ZoneStudyResponse>(`/planning/zone-study/manual/pick?${query.toString()}`, {
        method: 'POST',
        body: JSON.stringify({ zoneId }),
      });
    },
    unpick: (date: string, zoneId: number) => {
      const query = new URLSearchParams({ date });
      return request<ZoneStudyResponse>(
        `/planning/zone-study/manual/pick/${zoneId}?${query.toString()}`,
        { method: 'DELETE' },
      );
    },
  },
  workScopes: {
    get: (date: string, teamKey: string, branchId?: number) => {
      const qs = branchId ? `?branchId=${branchId}` : '';
      return request<any>(`/work-scopes/${encodeURIComponent(date)}/${encodeURIComponent(teamKey)}${qs}`);
    },
    create: (data: { date: string; teamKey: string; zoneIds?: number[]; scopeType?: string; branchId?: number }) =>
      request<any>('/work-scopes', { method: 'POST', body: JSON.stringify(data) }),
    activate: (id: number) =>
      request<any>(`/work-scopes/${id}/activate`, { method: 'PUT' }),
    generateTasks: (id: number) =>
      request<any>(`/work-scopes/${id}/generate-tasks`, { method: 'POST' }),
  },
  fieldVisits: {
    list: (params: {
      clientId?: number;
      date?: string;
      branchId?: number;
      status?: string;
      visitType?: string;
      taskType?: string;
      mineOnly?: boolean;
    }) => {
      const qs = new URLSearchParams();
      if (params.clientId) qs.append('clientId', String(params.clientId));
      if (params.date) qs.append('date', params.date);
      if (params.branchId) qs.append('branchId', String(params.branchId));
      if (params.status) qs.append('status', params.status);
      if (params.visitType) qs.append('visitType', params.visitType);
      if (params.taskType) qs.append('taskType', params.taskType);
      if (params.mineOnly) qs.append('mineOnly', 'true');
      return request<any[]>(`/field-visits/?${qs.toString()}`);
    },
    // "زياراتي" — the field member's own (team-assigned) visits. Gated server-side
    // by field_visits.my_visits.view (ASSIGNED) + team-membership predicate.
    myVisits: (params: { date: string; status?: string }) => {
      const qs = new URLSearchParams();
      qs.append('date', params.date);
      if (params.status) qs.append('status', params.status);
      return request<any[]>(`/field-visits/my-visits?${qs.toString()}`);
    },
    get: (id: number) => request<any>(`/field-visits/${id}`),
    start: (id: number, data?: { lat?: number; lng?: number; accuracy?: number; locationMissingReasonId?: number }) =>
      request<any>(`/field-visits/${id}/start`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
    end: (id: number, data?: { lat?: number; lng?: number; accuracy?: number; locationMissingReasonId?: number }) =>
      request<any>(`/field-visits/${id}/end`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
    cancel: (id: number, data: { cancellationReasonId: number; notes?: string | null }) =>
      request<any>(`/field-visits/${id}/cancel`, { method: 'POST', body: JSON.stringify(data) }),
    complete: (id: number) =>
      request<any>(`/field-visits/${id}/complete`, { method: 'POST' }),
    close: (id: number) =>
      request<any>(`/field-visits/${id}/close`, { method: 'POST' }),
    getGeo: (id: number) => request<any>(`/field-visits/${id}/geo`),
    getSource: (id: number) => request<any>(`/field-visits/${id}/source`),
    // Legacy name-collection wrappers removed 2026-06-10 — replaced by
    // referral_sheets per DEC-007 D40/D41. The only consumer
    // (NameCollectionModal.tsx) was deleted in the same change; current UI
    // uses ReferralSheetModal via the /referral-sheets endpoints below.

    addDirectSuggestion: (taskId: number, data: { name: string; phone?: string; notes?: string }) =>
      request<any>(`/field-visits/visit-tasks/${taskId}/direct-suggestions`, { method: 'POST', body: JSON.stringify(data) }),
    listDirectSuggestions: (taskId: number) =>
      request<any[]>(`/field-visits/visit-tasks/${taskId}/direct-suggestions`),
    /** DEC-003 D7 expanded: add an in-flight visit_task to an in_progress field_visit. */
    addTask: (id: number, data: {
      taskType: string;
      openTaskId?: number;
      reason?: string;
    }) => request<{ visitTaskId: number; sequenceNo: number; openTaskId: number }>(
      `/field-visits/${id}/tasks`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
    /** DEC-010: the customer's waiting-phase tasks (visit's branch) pullable into the visit. */
    pullableTasks: (id: number) => request<Array<{
      openTaskId: number; taskType: string; arabicLabel: string | null; taskFamily: string | null;
      status: string; reason: string | null; priority: string | null; creationOrigin: string | null;
      createdAt: string; expectedDate: string | null; expectedTime: string | null;
      contractId: number | null; contractNumber: string | null; deviceModelName: string | null;
      installmentId: number | null; installmentNumber: number | null;
      installmentAmount: number | string | null; installmentRemaining: number | string | null;
      expectedAmount: number | string | null; receivableLabel: string | null;
      taskAddress: string | null; taskGeoUnitId: number | null;
    }>>(`/field-visits/${id}/pullable-tasks`),
    /** DEC-010 D-PB8: undo a pull (pulled + pending only). */
    removePulledTask: (id: number, visitTaskId: number) =>
      request<{ success: boolean; removedVisitTaskId: number; restoredOpenTaskId: number | null }>(
        `/field-visits/${id}/tasks/${visitTaskId}`,
        { method: 'DELETE' },
      ),
    /** DEC-011: create a field-initiated instant visit (starts in_progress now). */
    createInstant: (data: {
      clientId: number;
      lat?: number | null;
      lng?: number | null;
      accuracy?: number | null;
      locationMissingReasonId?: number | null;
    }) => request<{ success: boolean; fieldVisitId: number }>(
      `/field-visits/instant`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
    recordTaskResult: (visitId: number, taskId: number, data: any) =>
      request<any>(`/field-visits/${visitId}/tasks/${taskId}/result`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    // ── DEC-007 D40/D41: referral sheet on the visit ──────────────────────
    getReferralSheet: (id: number) => request<{
      id: number; fieldVisitId: number; targetCandidates: number;
      ownerUserId: number | null; status: string;
      referralNameSnapshot: string | null; referralAddressText: string | null;
    } | null>(`/field-visits/${id}/referral-sheet`),
    createReferralSheet: (id: number, data: { targetCandidates: number }) =>
      request<any>(`/field-visits/${id}/referral-sheet`, { method: 'POST', body: JSON.stringify(data) }),
    updateReferralTarget: (id: number, targetCandidates: number) =>
      request<any>(`/field-visits/${id}/referral-sheet/target`, { method: 'PATCH', body: JSON.stringify({ targetCandidates }) }),
    // ── DEC-007 D42/D43/D44: visit survey ────────────────────────────────
    getSurvey: (id: number) => request<{
      id: number; fieldVisitId: number; isSkipped: boolean; skipReason: string | null;
      filledByUserId: number | null; filledAt: string | null;
      householdMembersCount: number | null;
      drinkingWaterSource: string | null;
      tdsTestResult: number | null;
      hardnessTestDrops: number | null;
      demoKitTdsResult: number | null;
      customerOpinionWaterSource: string | null;
      customerOpinionDemoKit: string | null;
      customerOpinionPurificationIdea: string | null;
      customerPurchaseIntent: boolean | null;
      expectedPaymentMethod: string | null;
      areaEvaluation: string | null;
    } | null>(`/field-visits/${id}/survey`),
    saveSurvey: (id: number, data: {
      householdMembersCount: number;
      drinkingWaterSource: string;
      tdsTestResult: number;
      hardnessTestDrops: number;
      demoKitTdsResult: number;
      customerOpinionWaterSource: string;
      customerOpinionDemoKit: string;
      customerOpinionPurificationIdea: string;
      customerPurchaseIntent: boolean;
      expectedPaymentMethod: string;
      areaEvaluation: string;
    }) => request<{ survey: any; completion: any }>(
      `/field-visits/${id}/survey`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
    skipSurvey: (id: number, skipReason: string) =>
      request<{ survey: any; completion: any }>(
        `/field-visits/${id}/survey/skip`,
        { method: 'POST', body: JSON.stringify({ skipReason }) },
      ),
    /** DEC-004 D11: reopen a closed visit. Requires field_visits.reopen_closed. */
    reopen: (id: number, reason: string) =>
      request<{ success: boolean }>(
        `/field-visits/${id}/reopen`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      ),
    /** DEC-006 D38: visits with active escalation alerts (scoped to caller's branch). */
    escalationAlerts: () => request<{
      count: number;
      items: Array<{
        visitId: number;
        status: string;
        branchId: number;
        clientId: number;
        clientName: string | null;
        teamResponsibleUserId: number | null;
        hoursSinceUpdate: number;
        tiersAlerted: number[];
      }>;
      scheduledCount: number;
      scheduledItems: Array<{
        visitId: number;
        status: string;
        branchId: number;
        clientId: number;
        clientName: string | null;
        teamResponsibleUserId: number | null;
        teamResponsibleName: string | null;
        scheduledDate: string;
        scheduledTime: string | null;
        alertedAt: string;
        hoursSinceAlert: number;
      }>;
    }>('/field-visits/escalation-alerts'),
    /** Executive view: one row per branch with comparison KPIs over a date range. */
    branchSummary: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.append('from', params.from);
      if (params?.to) qs.append('to', params.to);
      const query = qs.toString() ? `?${qs.toString()}` : '';
      return request<{
        from: string;
        to: string;
        branches: Array<{
          branchId: number;
          branchName: string | null;
          total: number;
          scheduled: number;
          inProgress: number;
          ended: number;
          completed: number;
          notCompleted: number;
          cancelled: number;
          stuckEscalated: number;
          locationMissing: number;
          avgDurationMinutes: number;
          // Device-demo pre-offer outcomes within the period.
          demoOffersPresented: number;
          demoOffersAccepted: number;
          demoOffersRejected: number;
          demoOffersExtension: number;
          demoOffersPending: number;
        }>;
      }>(`/field-visits/branch-summary${query}`);
    },
    /** Task-type analytics: one row per active task_type with universal KPIs +
     *  type-specific success indicators (currently only device_demo). */
    taskTypeSummary: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.append('from', params.from);
      if (params?.to) qs.append('to', params.to);
      const query = qs.toString() ? `?${qs.toString()}` : '';
      return request<{
        from: string;
        to: string;
        taskTypes: Array<{
          taskType: string;
          taskFamily: string;
          arabicLabel: string;
          displayOrder: number;
          totalAttempts: number;
          completed: number;
          notCompleted: number;
          cancelled: number;
          inProgress: number;
          pending: number;
          documented: number;
          demoOffersPresented: number | null;
          demoOffersAccepted: number | null;
          demoOffersRejected: number | null;
          demoOffersExtension: number | null;
          demoOffersPending: number | null;
        }>;
      }>(`/field-visits/task-type-summary${query}`);
    },
  },
  marketingVisits: {
    list: (date: string, clientId?: number) => {
      const qs = new URLSearchParams();
      if (date) qs.append('date', date);
      if (clientId) qs.append('clientId', String(clientId));
      const query = qs.toString() ? `?${qs.toString()}` : '';
      return request<any[]>(`/marketing-visits${query}`);
    },
    get: (id: string) => request<any>(`/marketing-visits/${id}`),
    updateResult: (id: string, data: any) => request<any>(`/marketing-visits/${id}/result`, { method: 'PATCH', body: JSON.stringify(data) }),
    updateTaskResult: (visitId: string, taskId: string, data: any) => request<any>(`/marketing-visits/${visitId}/tasks/${taskId}/result`, { method: 'PATCH', body: JSON.stringify(data) }),
    updateStatus: (visitId: string, status: string, gps?: { lat: number; lng: number; accuracy: number | null }) =>
      request<any>(`/marketing-visits/${visitId}/status`, { method: 'PATCH', body: JSON.stringify({ status, gps: gps ?? null }) }),
    updateTaskOutcome: (visitId: string, taskId: string, data: any) =>
      request<any>(`/marketing-visits/${visitId}/tasks/${taskId}/outcome`, { method: 'PATCH', body: JSON.stringify(data) }),
    reschedule: (visitId: string, data: MarketingVisitRescheduleRequest) =>
      request<any>(`/marketing-visits/${visitId}/reschedule`, { method: 'PATCH', body: JSON.stringify(data) }),
    cancel: (visitId: string, data: MarketingVisitCancelRequest) =>
      request<any>(`/marketing-visits/${visitId}/cancel`, { method: 'PATCH', body: JSON.stringify(data) }),
    close: (visitId: string, closingNotes?: string) =>
      request<any>(`/marketing-visits/${visitId}/close`, {
        method: 'POST',
        body: JSON.stringify({ closingNotes: closingNotes ?? null }),
      }),
    linkOfferContract: (visitId: string, taskId: string, offerId: number, contractId: number) =>
      request<any>(`/marketing-visits/${visitId}/tasks/${taskId}/offers/${offerId}/contract`, {
        method: 'PATCH',
        body: JSON.stringify({ contractId }),
      }),
    updateTeam: (visitId: string, data: {
      supervisorEmployeeId?: number | null;
      technicianEmployeeId?: number | null;
      traineeEmployeeId?: number | null;
      telemarketerEmployeeIds?: number[];
    }) => request<any>(`/marketing-visits/${visitId}/team`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  telemarketing: {
    snapshot: (date?: string) => {
      const qs = date ? `?date=${encodeURIComponent(date)}` : '';
      return request<{ taskLists: any[]; appointments: any[]; callLogs: any[] }>(`/telemarketing/snapshot${qs}`);
    },
    // DEC-009 لبنة 8 — the blind DELETE+re-INSERT upsert path was removed; the live
    // flow uses generateTaskListFromPlan (idempotent merge that preserves call progress).
    generateTaskListFromPlan: (data: { date: string; teamKey: string }) => request<any>('/telemarketing/task-lists/generate-from-plan', { method: 'POST', body: JSON.stringify(data) }),
    updateTaskListItem: (taskListId: string, itemId: string, data: any) => request<any>(`/telemarketing/task-lists/${taskListId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    createCallLog: (data: any) => request<any>('/telemarketing/call-logs', { method: 'POST', body: JSON.stringify(data) }),
    claimContactTarget: (contactTargetId: number) => request<{
      lockedByHrUserId: number | null;
      lockedByHrUserName: string | null;
      lockedAt: string | null;
    }>(`/telemarketing/contact-targets/${contactTargetId}/claim`, { method: 'POST' }),
    customerTargetsToday: (customerId: number, date?: string) => {
      const qs = date ? `?date=${encodeURIComponent(date)}` : '';
      return request<{
        customerId: number;
        date: string;
        items: any[];
      }>(`/telemarketing/customer/${customerId}/all-targets-today${qs}`);
    },
    // createAppointment removed 2026-06-10 (Phase 1.2) — backend endpoint
    // POST /telemarketing/appointments returns 410 Gone. All callers now go
    // through bookVisit below per DEC-003 D2.
    /** DEC-003 D2 canonical booking endpoint — creates field_visit directly. */
    bookVisit: (data: {
      clientId?: number;
      date: string;
      timeSlot: string;
      teamKey: string;
      taskListId?: string;
      taskListItemId?: string;
      callLogId?: string | number;
      selectedOpenTasks?: Array<{ openTaskId: number; taskType: string }>;
      customerSnapshot?: Record<string, unknown> | null;
      notes?: string | null;
      telemarketerNotes?: string | null;
      answeredBy?: 'customer' | 'spouse' | 'child' | 'other' | null;
      fieldInstructions?: string | null;
    }) => request<{ fieldVisitId: number; visitTaskIds: number[]; contactTargetId: number | null }>(
      '/telemarketing/book-visit',
      { method: 'POST', body: JSON.stringify(data) },
    ),
    taskTypeOptions: () => request<{ taskType: string; arabicLabel: string; taskFamily: string }[]>('/telemarketing/task-type-options'),
    serviceTaskDevices: (clientId: number, taskType: string) => {
      const qs = new URLSearchParams({ clientId: String(clientId), taskType });
      return request<Array<{
        id: number;
        status: string;
        contractId: number | null;
        serialNumber: string | null;
        deviceModelName: string;
        eligible: boolean;
        eligibilityCode: string;
        eligibilityReason: string;
      }>>(`/telemarketing/service-task-devices?${qs}`);
    },
    createServiceTask: (data: { clientId: number; taskType: string; installedDeviceId?: number; notes?: string; priority?: string }) =>
      request<any>('/telemarketing/service-tasks', { method: 'POST', body: JSON.stringify(data) }),
  },
  systemLists: {
    list: (params?: { category?: string; activeOnly?: boolean }) => {
      const query = new URLSearchParams();
      if (params?.category) query.append('category', params.category);
      if (params?.activeOnly) query.append('activeOnly', 'true');
      const qs = query.toString() ? `?${query.toString()}` : '';
      return request<any[]>(`/system-lists${qs}`);
    },
    getItemsByCode: (code: string) => request<any[]>(`/system-lists/${code}/items`),
    create: (data: any) => request<any>('/system-lists', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/system-lists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/system-lists/${id}`, { method: 'DELETE' }),
  },
  systemSettings: {
    list: () => request<{ settings: Array<{ key: string; value: string; valueType: string; category: string | null; description: string | null }> }>(
      '/system-settings',
    ),
    setContactTargetCleanupTime: (time: string) => request<{ key: string; value: string }>(
      '/system-settings/contact-target-cleanup-time',
      { method: 'PUT', body: JSON.stringify({ time }) },
    ),
    update: (key: string, value: unknown) => request<{ key: string; value: string }>(
      `/system-settings/${encodeURIComponent(key)}`,
      { method: 'PUT', body: JSON.stringify({ value }) },
    ),
  },
  departments: {
    // branchId narrows a GLOBAL viewer to one branch (sent as X-Branch-Id, the
    // header the list endpoint now reads); null/undefined lets the server scope.
    list: (branchId?: number | null) => request<any[]>(
      '/departments',
      branchId != null ? { headers: { 'X-Branch-Id': String(branchId) } } : undefined,
    ),
    get: (id: number) => request<any>(`/departments/${id}`),
    create: (data: any) => request<any>('/departments', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/departments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/departments/${id}`, { method: 'DELETE' }),
  },
  // ─────────────────────────────────────────────────────────────────
  // Service Requests (Phase 3) — intake layer for emergency_maintenance
  // ─────────────────────────────────────────────────────────────────
  appAccounts: {
    forClient: (clientId: number) =>
      request<{ account: any | null }>(`/admin/clients/${clientId}/app-account`),
    createDirect: (clientId: number) =>
      request<any>(`/admin/clients/${clientId}/app-account`, { method: 'POST', body: '{}' }),
    bulkActivate: (body: { mode: 'filter' | 'ids'; filter?: any; clientIds?: number[] }) =>
      request<any>(`/admin/app-accounts/bulk-activate`, { method: 'POST', body: JSON.stringify(body) }),
    suspend: (id: number, reason: string) =>
      request<any>(`/admin/app-accounts/${id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) }),
    reactivate: (id: number) =>
      request<any>(`/admin/app-accounts/${id}/reactivate`, { method: 'POST', body: '{}' }),
  },
  accountRequests: {
    list: (params: Record<string, string | number | boolean | undefined> = {}) => {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '' && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      return request<{ items: any[]; limit: number; offset: number }>(
        `/admin/account-requests${qs ? `?${qs}` : ''}`,
      );
    },
    get: (id: number) =>
      request<{ request: any; audit: any[] }>(`/admin/account-requests/${id}`),
    suggestions: (id: number) =>
      request<{ suggestions: any[] }>(`/admin/account-requests/${id}/suggestions`),
    claim: (id: number) =>
      request<any>(`/admin/account-requests/${id}/claim`, { method: 'POST' }),
    takeOver: (id: number, transferReason?: string) =>
      request<any>(`/admin/account-requests/${id}/take-over`, {
        method: 'POST',
        body: JSON.stringify({ transferReason: transferReason ?? null }),
      }),
    reopen: (id: number, reopenReason: string) =>
      request<any>(`/admin/account-requests/${id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reopenReason }),
      }),
    addNote: (id: number, note: string) =>
      request<any>(`/admin/account-requests/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    link: (id: number, clientId: number) =>
      request<any>(`/admin/account-requests/${id}/link`, {
        method: 'POST',
        body: JSON.stringify({ clientId }),
      }),
    escalate: (id: number, reason: string) =>
      request<any>(`/admin/account-requests/${id}/escalate`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    reject: (id: number, reasonCode: string) =>
      request<any>(`/admin/account-requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reasonCode }),
      }),
    resolveEscalation: (id: number, note?: string | null) =>
      request<any>(`/admin/account-requests/${id}/resolve-escalation`, {
        method: 'POST',
        body: JSON.stringify({ note: note ?? null }),
      }),
    archive: (id: number, reason?: string | null) =>
      request<any>(`/admin/account-requests/${id}/archive`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? null }),
      }),
    unarchive: (id: number) =>
      request<any>(`/admin/account-requests/${id}/unarchive`, { method: 'POST' }),
  },
  serviceRequests: {
    create: (data: any) =>
      request<any>('/service-requests', { method: 'POST', body: JSON.stringify(data) }),
    createWaterCheck: (data: any) =>
      request<any>('/service-requests/water-check', { method: 'POST', body: JSON.stringify(data) }),
    createInternal: (data: any) =>
      request<any>('/service-requests/internal', { method: 'POST', body: JSON.stringify(data) }),
    createInternalWithCall: (call: any, serviceRequest: any) =>
      request<any>('/service-requests/internal-with-call', {
        method: 'POST',
        body: JSON.stringify({ call, request: serviceRequest }),
      }),
    list: (params: Record<string, string | number | boolean | undefined> = {}) => {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '' && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      return request<{ items: any[]; total: number; limit: number; offset: number }>(
        `/service-requests${qs ? `?${qs}` : ''}`,
      );
    },
    get: (id: number) =>
      request<{ request: any; auditLog: any[]; problems: any[] }>(`/service-requests/${id}`),
    claim: (id: number) =>
      request<any>(`/service-requests/${id}/claim`, { method: 'POST', body: '{}' }),
    takeOver: (id: number, reason?: string | null) =>
      request<any>(`/service-requests/${id}/take-over`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? null }),
      }),
    link: (id: number, data: any) =>
      request<any>(`/service-requests/${id}/link`, { method: 'POST', body: JSON.stringify(data) }),
    changeLinkage: (id: number, data: any) =>
      request<any>(`/service-requests/${id}/change-linkage`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    suggestedMatches: (id: number, party?: 'beneficiary' | 'requester' | 'referrer') =>
      request<{ clients: any[]; candidates: any[] }>(
        `/service-requests/${id}/suggested-matches${party ? `?party=${party}` : ''}`,
      ),
    linkRequester: (id: number, requesterClientId: number) =>
      request<any>(`/service-requests/${id}/link-requester`, {
        method: 'POST',
        body: JSON.stringify({ requesterClientId }),
      }),
    linkReferrer: (id: number, referrerClientId: number) =>
      request<any>(`/service-requests/${id}/link-referrer`, {
        method: 'POST',
        body: JSON.stringify({ referrerClientId }),
      }),
    resolveAtIntake: (id: number, body: any) =>
      request<any>(`/service-requests/${id}/resolve-at-intake`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    escalate: (id: number, reason?: string | null) =>
      request<any>(`/service-requests/${id}/escalate`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? null }),
      }),
    resolveEscalation: (id: number, reason?: string | null) =>
      request<any>(`/service-requests/${id}/resolve-escalation`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? null }),
      }),
    reject: (id: number, body: any) =>
      request<any>(`/service-requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    cancel: (id: number, body: any) =>
      request<any>(`/service-requests/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    reopen: (id: number, body: any) =>
      request<any>(`/service-requests/${id}/reopen`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    /**
     * Promote returns 409 with { error:'merge_or_split_required',
     * existingOpenTaskId, installedDeviceId } on EM-UNIQ-01 collision.
     * Callers should catch and route to the MergeOrSplit modal.
     */
    promote: async (id: number, body: any = {}) => {
      const token = localStorage.getItem('hr_token');
      const res = await fetch(`${API_BASE}/service-requests/${id}/promote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.error === 'merge_or_split_required') {
        return { collision: data as { existingOpenTaskId: number; installedDeviceId: number } };
      }
      if (!res.ok) {
        const error = Object.assign(new Error(data?.message || data?.error || `API Error ${res.status}`), {
          code: data?.error,
          details: data?.details,
          status: res.status,
        });
        throw error;
      }
      return { ok: data };
    },
    merge: (id: number, existingOpenTaskId: number, note?: string | null) =>
      request<any>(`/service-requests/${id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ existingOpenTaskId, note: note ?? null }),
      }),
    handoffWaterCheck: (
      id: number,
      data: {
        priority?: 'high' | 'medium' | 'low';
        operatorNote?: string | null;
        dueDate?: string | null;
        creationReason?: string | null;
      } = {},
    ) =>
      request<any>(`/service-requests/${id}/handoff-water-check`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    approveAgentLicense: (id: number, note?: string | null) =>
      request<any>(`/service-requests/${id}/approve-agent-license`, {
        method: 'POST', body: JSON.stringify({ note: note ?? null }),
      }),
    handoffGoldenWarranty: (id: number, body: any = {}) =>
      request<any>(`/service-requests/${id}/handoff-golden-warranty`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    refreshNameNominationBranches: (id: number) =>
      request<any>(`/service-requests/${id}/name-nomination/refresh-branches`, { method: 'POST', body: '{}' }),
    convertNameNominationItems: (id: number, itemIds: number[]) =>
      request<any>(`/service-requests/${id}/name-nomination/convert`, {
        method: 'POST', body: JSON.stringify({ itemIds }),
      }),
    skipNameNominationItems: (id: number, itemIds: number[], reasonId: number) =>
      request<any>(`/service-requests/${id}/name-nomination/skip`, {
        method: 'POST', body: JSON.stringify({ itemIds, reasonId }),
      }),
    handoffDeviceRequest: (id: number, data: {
      employeeId: number;
      deviceModelIds: number[];
      inactiveModelsConfirmed?: boolean;
      priority?: 'high' | 'medium' | 'low';
      dueDate?: string | null;
      operatorNote?: string | null;
    }) => request<any>(`/service-requests/${id}/handoff-device-request`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    handoffPeriodicMaintenance: (
      id: number,
      data: { deviceLocationDecision?: 'registered_location_confirmed' | null } = {},
    ) => request<any>(`/service-requests/${id}/handoff-periodic-maintenance`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    archive: (id: number, reason?: string | null) =>
      request<any>(`/service-requests/${id}/archive`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? null }),
      }),
    unarchive: (id: number, reason?: string | null) =>
      request<any>(`/service-requests/${id}/unarchive`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? null }),
      }),
    addNote: (id: number, note: string) =>
      request<any>(`/service-requests/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    // Problems
    addProblem: (id: number, data: any) =>
      request<any>(`/service-requests/${id}/problems`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    editProblem: (id: number, pid: number, data: any) =>
      request<any>(`/service-requests/${id}/problems/${pid}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    setProblemStatus: (id: number, pid: number, data: any) =>
      request<any>(`/service-requests/${id}/problems/${pid}/status`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    recordProblemResolution: (id: number, pid: number, data: any) =>
      request<any>(`/service-requests/${id}/problems/${pid}/record-resolution`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    deleteProblem: (id: number, pid: number, reason: string) =>
      request<any>(`/service-requests/${id}/problems/${pid}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      }),
    restoreProblem: (id: number, pid: number, reason: string) =>
      request<any>(`/service-requests/${id}/problems/${pid}/restore`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    overrideProblem: (id: number, pid: number, newStatus: string, reason: string) =>
      request<any>(`/service-requests/${id}/problems/${pid}/override`, {
        method: 'POST',
        body: JSON.stringify({ newStatus, reason }),
      }),
  },
  openTaskProblems: {
    list: (openTaskId: number) =>
      request<{ items: any[]; total: number }>(`/open-tasks/${openTaskId}/problems`),
    derivedOutcome: (openTaskId: number) =>
      request<{ outcome: string; counts: Record<string, number>; total: number }>(
        `/open-tasks/${openTaskId}/derived-outcome`,
      ),
  },
};
