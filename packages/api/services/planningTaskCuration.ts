import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AuthContext } from '@golden-crm/shared';
import pool from '../db.js';
import { JWT_SECRET } from '../config/env.js';
import { authorize } from './authorizationService.js';
import {
  getPlanningWorkScope,
  type WorkScopeTask,
} from './planningMarketingTargets.js';
import { resolveAssignmentOwningBranch } from '../policies/routeAssignmentPolicy.js';
import { canEditClientContactControl } from '../policies/clientPolicy.js';
import { eligiblePersonalOwnerCondition } from './customerOwnership.js';

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

export type PlanningLifecycleStatus = 'ready' | 'queued' | 'contacted' | 'closed';

export type PlanningDashboardFilters = {
  q?: string;
  lifecycleStatuses?: PlanningLifecycleStatus[];
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
};

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

export type PlanningContactTask = {
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
  assignment: {
    teamKey: string | null;
    date: string | null;
    committed: boolean;
  };
  blocks: {
    clientDoNotContact: boolean;
    clientCooldown: boolean;
    allTeamsDay: boolean;
    currentTeamDay: boolean;
  };
  exclusionReasonCode: string | null;
  exclusionReasonText: string | null;
  availableActions: Array<
    | 'EXCLUDE_TEAM_DAY'
    | 'EXCLUDE_ALL_TEAMS_DAY'
    | 'RESTORE_TEAM_DAY'
    | 'RESTORE_ALL_TEAMS_DAY'
  >;
};

export type PlanningContactRow = {
  rowKey: string;
  clientId: number;
  clientName: string;
  primaryPhone: string | null;
  classification: string | null;
  ownershipType: string;
  ownerLabel: string;
  workLocationGeoUnitId: number | null;
  workLocationName: string | null;
  lifecycleStatus: PlanningLifecycleStatus;
  contactTarget: {
    id: number;
    status: string;
    closingReason: string | null;
  } | null;
  listState: {
    generated: boolean;
    itemCount: number;
    committedTaskCount: number;
  };
  contactBlocks: {
    doNotContact: boolean;
    cooldownUntil: string | null;
  };
  counts: {
    totalTasks: number;
    matchingTasks: number;
    actionableTasks: number;
  };
  tasks: PlanningContactTask[];
};

export type PlanningDashboardResponse = {
  date: string;
  teamKey: string;
  planState: 'PRE_GENERATION' | 'COMMITTED';
  generatedAt: string | null;
  rows: PlanningContactRow[];
  pagination: {
    page: number;
    limit: number;
    totalContacts: number;
    totalPages: number;
  };
  summary: {
    contacts: number;
    tasks: number;
    matchingTasks: number;
    actionableTasks: number;
    matchingActionableTasks: number;
    ready: number;
    queued: number;
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
};

export function filterPlanningCurationTasksForAction(
  tasks: PlanningContactTask[],
  action: PlanningCurationAction,
  layer: PlanningExclusionLayer,
): { tasks: PlanningContactTask[]; skippedUnavailableTasks: number } {
  if (
    (action !== 'EXCLUDE' && action !== 'RESTORE')
    || (layer !== 'TEAM_DAY' && layer !== 'ALL_TEAMS_DAY')
  ) {
    return { tasks, skippedUnavailableTasks: 0 };
  }
  const requiredAction = action === 'EXCLUDE'
    ? (layer === 'TEAM_DAY' ? 'EXCLUDE_TEAM_DAY' : 'EXCLUDE_ALL_TEAMS_DAY')
    : (layer === 'TEAM_DAY' ? 'RESTORE_TEAM_DAY' : 'RESTORE_ALL_TEAMS_DAY');
  const actionableTasks = tasks.filter(task => task.availableActions.includes(requiredAction));
  return {
    tasks: actionableTasks,
    skippedUnavailableTasks: tasks.length - actionableTasks.length,
  };
}

type Queryable = Pick<typeof pool, 'query'>;

type ContactTargetMeta = {
  id: number;
  clientId: number;
  workLocationGeoUnitId: number | null;
  status: string;
  closingReason: string | null;
  itemCount: number;
  committedTaskCount: number;
};

type BuiltDashboard = Omit<PlanningDashboardResponse, 'rows' | 'pagination'> & {
  allRows: PlanningContactRow[];
  filteredRows: PlanningContactRow[];
};

type ResolvedSelection = {
  built: BuiltDashboard;
  rows: PlanningContactRow[];
  tasks: PlanningContactTask[];
  contacts: Array<{ clientId: number; rowKeys: string[] }>;
  selectionFingerprint: string;
  skippedUnavailableTasks: number;
};

export class PlanningCurationError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'PLANNING_CURATION_ERROR',
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PlanningCurationError';
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TEAM_RE = /^(team|solo)_\d+$/;
const EXCLUDABLE_STATES = new Set(['open', 'needs_follow_up', 'assigned']);
const COMMITTED_STATES = new Set([
  'in_scheduling',
  'scheduled',
  'waiting_execution',
  'in_execution',
  'ended',
  'completed',
  'closed',
]);
const CURATION_TOKEN_AUDIENCE = 'planning-curation-apply';
const CURATION_TOKEN_ISSUER = 'golden-crm-planning';
const DASHBOARD_SCOPE_TASK_LIMIT = 20_000;

function uniquePositiveIntegers(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0),
  )).sort((a, b) => a - b);
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .filter(value => typeof value === 'string')
      .map(value => String(value).trim())
      .filter(Boolean),
  )).sort();
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function normalizePlanningDashboardFilters(
  raw: PlanningDashboardFilters | null | undefined,
): PlanningDashboardFilters {
  const filters = raw ?? {};
  const q = typeof filters.q === 'string' ? filters.q.trim().slice(0, 120) : '';
  const dueState = ['OVERDUE', 'ON_DATE', 'FUTURE', 'NO_DATE'].includes(String(filters.dueState))
    ? filters.dueState
    : undefined;
  const phoneState = ['VALID', 'MISSING'].includes(String(filters.phoneState))
    ? filters.phoneState
    : undefined;
  const lifecycleStatuses = uniqueStrings(filters.lifecycleStatuses)
    .filter(value => ['ready', 'queued', 'contacted', 'closed'].includes(value)) as PlanningLifecycleStatus[];
  const exclusionLayers = uniqueStrings(filters.exclusionLayers)
    .filter(value => ['TEAM_DAY', 'ALL_TEAMS_DAY', 'CLIENT_DO_NOT_CONTACT', 'NONE'].includes(value)) as Array<PlanningExclusionLayer | 'NONE'>;

  return {
    ...(q ? { q } : {}),
    ...(lifecycleStatuses.length ? { lifecycleStatuses } : {}),
    ...(uniquePositiveIntegers(filters.stationIds).length
      ? { stationIds: uniquePositiveIntegers(filters.stationIds) }
      : {}),
    ...(uniqueStrings(filters.classifications).length
      ? { classifications: uniqueStrings(filters.classifications) }
      : {}),
    ...(uniqueStrings(filters.ownershipTypes).length
      ? { ownershipTypes: uniqueStrings(filters.ownershipTypes) }
      : {}),
    ...(boundedInteger(filters.minTaskCount, 0, 100_000) != null
      ? { minTaskCount: boundedInteger(filters.minTaskCount, 0, 100_000) }
      : {}),
    ...(boundedInteger(filters.maxTaskCount, 0, 100_000) != null
      ? { maxTaskCount: boundedInteger(filters.maxTaskCount, 0, 100_000) }
      : {}),
    ...(uniquePositiveIntegers(filters.taskIds).length
      ? { taskIds: uniquePositiveIntegers(filters.taskIds) }
      : {}),
    ...(uniqueStrings(filters.taskTypes).length
      ? { taskTypes: uniqueStrings(filters.taskTypes) }
      : {}),
    ...(uniqueStrings(filters.taskFamilies).length
      ? { taskFamilies: uniqueStrings(filters.taskFamilies) }
      : {}),
    ...(uniqueStrings(filters.taskStatuses).length
      ? { taskStatuses: uniqueStrings(filters.taskStatuses) }
      : {}),
    ...(uniqueStrings(filters.priorities).length
      ? { priorities: uniqueStrings(filters.priorities) }
      : {}),
    ...(dueState ? { dueState } : {}),
    ...(boundedInteger(filters.attemptsMin, 0, 1_000_000) != null
      ? { attemptsMin: boundedInteger(filters.attemptsMin, 0, 1_000_000) }
      : {}),
    ...(phoneState ? { phoneState } : {}),
    ...(exclusionLayers.length ? { exclusionLayers } : {}),
  };
}

function validateContext(date: string, teamKey: string, branchId: number) {
  if (!DATE_RE.test(date)) {
    throw new PlanningCurationError('date يجب أن يكون بصيغة YYYY-MM-DD', 400, 'INVALID_DATE');
  }
  if (!TEAM_RE.test(teamKey)) {
    throw new PlanningCurationError('teamKey غير صالح', 400, 'INVALID_TEAM_KEY');
  }
  if (!Number.isInteger(branchId) || branchId <= 0) {
    throw new PlanningCurationError('يجب تحديد فرع فعّال', 400, 'BRANCH_REQUIRED');
  }
}

async function assertPlanningSubject(
  authContext: AuthContext,
  date: string,
  teamKey: string,
  branchId: number,
  db: Queryable = pool,
) {
  // planning.manage is a management capability with GLOBAL/BRANCH catalog
  // scopes. Passing an explicit unassigned subject makes an invalid ASSIGNED
  // grant fail closed instead of being treated as authorize()'s middleware
  // self-check.
  const access = authorize(authContext, {
    permission: 'planning.manage',
    branchId,
    assignedUserId: null,
  });
  if (!access.allowed) {
    throw new PlanningCurationError(
      'ليس لديك نطاق إدارة التخطيط لهذا الفرع',
      403,
      access.reason ?? 'PLANNING_SCOPE_FORBIDDEN',
    );
  }

  const owningBranchId = await resolveAssignmentOwningBranch(date, teamKey, db);
  if (owningBranchId == null) {
    throw new PlanningCurationError(
      'الفريق غير موجود في جدول هذا اليوم أو لا يمكن تحديد فرعه',
      404,
      'TEAM_SUBJECT_NOT_FOUND',
    );
  }
  if (owningBranchId !== branchId) {
    throw new PlanningCurationError(
      'الفريق المحدد لا يتبع الفرع الفعّال',
      403,
      'TEAM_BRANCH_FORBIDDEN',
      { owningBranchId, branchId },
    );
  }
}

export async function assertPlanningTeamSubject(
  authContext: AuthContext,
  date: string,
  teamKey: string,
  branchId: number,
  db: Queryable = pool,
) {
  validateContext(date, teamKey, branchId);
  await assertPlanningSubject(authContext, date, teamKey, branchId, db);
}

function contextKey(clientId: number, workLocationGeoUnitId: number | null): string {
  return `${clientId}:${workLocationGeoUnitId == null ? 'none' : workLocationGeoUnitId}`;
}

function opaqueRowKey(clientId: number, workLocationGeoUnitId: number | null, date: string): string {
  return Buffer.from(
    `v1|${clientId}|${workLocationGeoUnitId == null ? 'none' : workLocationGeoUnitId}|${date}`,
    'utf8',
  ).toString('base64url');
}

function hashValue(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isCooldownActive(until: string | null, date: string): boolean {
  return typeof until === 'string' && until.slice(0, 10) >= date;
}

function dueState(task: WorkScopeTask, date: string): PlanningDashboardFilters['dueState'] {
  const effectiveDate = (task.expectedDate ?? task.dueDate)?.slice(0, 10) ?? null;
  if (!effectiveDate) return 'NO_DATE';
  if (effectiveDate < date) return 'OVERDUE';
  if (effectiveDate === date) return 'ON_DATE';
  return 'FUTURE';
}

function lifecycleFromTarget(target: ContactTargetMeta | null): PlanningLifecycleStatus {
  if (!target) return 'ready';
  if (target.status === 'closed' || target.status === 'booked' || target.status === 'cancelled') {
    return 'closed';
  }
  if (target.status === 'contacted') return 'contacted';
  if (target.status === 'queued' || target.status === 'in_call_list') return 'queued';
  return 'ready';
}

function taskStateFingerprint(task: PlanningContactTask) {
  return {
    id: task.taskId,
    clientId: task.clientId,
    status: task.status,
    teamKey: task.assignment.teamKey,
    date: task.assignment.date?.slice(0, 10) ?? null,
    allTeamsDay: task.blocks.allTeamsDay,
    currentTeamDay: task.blocks.currentTeamDay,
    doNotContact: task.blocks.clientDoNotContact,
    cooldown: task.blocks.clientCooldown,
    committed: task.assignment.committed,
  };
}

function makeTask(
  task: WorkScopeTask,
  date: string,
): PlanningContactTask {
  const clientCooldown = isCooldownActive(task.clientCooldownUntil, date);
  const committed = task.committedArtifact || COMMITTED_STATES.has(task.status);
  const availableActions: PlanningContactTask['availableActions'] = [];
  if (!committed) {
    if (task.currentTeamDayExcluded) availableActions.push('RESTORE_TEAM_DAY');
    else if (EXCLUDABLE_STATES.has(task.status)) availableActions.push('EXCLUDE_TEAM_DAY');
    if (task.allTeamsDayExcluded) availableActions.push('RESTORE_ALL_TEAMS_DAY');
    else if (EXCLUDABLE_STATES.has(task.status)) availableActions.push('EXCLUDE_ALL_TEAMS_DAY');
  }

  return {
    taskId: Number(task.openTaskId),
    clientId: Number(task.clientId),
    taskType: task.taskType,
    taskTypeLabel: task.taskTypeLabel,
    taskFamily: task.taskFamily,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    expectedDate: task.expectedDate,
    createdAt: task.createdAt,
    attemptCount: task.attemptCount,
    matchesTaskFilters: true,
    assignment: {
      teamKey: task.assignedTeamKey,
      date: task.assignedForDate,
      committed,
    },
    blocks: {
      clientDoNotContact: task.clientDoNotContact,
      clientCooldown,
      allTeamsDay: task.allTeamsDayExcluded,
      currentTeamDay: task.currentTeamDayExcluded,
    },
    exclusionReasonCode: task.exclusionReasonCode,
    exclusionReasonText: task.exclusionReasonText,
    availableActions,
  };
}

async function loadContactTargetMeta(
  db: Queryable,
  branchId: number,
  date: string,
  teamKey: string,
  clientIds: number[],
): Promise<Map<string, ContactTargetMeta>> {
  const result = new Map<string, ContactTargetMeta>();
  if (clientIds.length === 0) return result;

  const { rows } = await db.query(
    `SELECT
       ct.id,
       ct.target_id AS "clientId",
       ct.work_location_geo_unit_id AS "workLocationGeoUnitId",
       ct.status,
       ct.closing_reason AS "closingReason",
       COUNT(DISTINCT tli.id)::int AS "itemCount",
       COUNT(DISTINCT ctot.open_task_id) FILTER (
         WHERE ot.status IN (
           'in_scheduling', 'scheduled', 'waiting_execution',
           'in_execution', 'ended', 'completed', 'closed'
         )
       )::int AS "committedTaskCount"
     FROM contact_targets ct
     LEFT JOIN telemarketing_task_list_items tli
       ON tli.contact_target_id = ct.id
     LEFT JOIN contact_target_open_tasks ctot
       ON ctot.contact_target_id = ct.id
      AND ctot.date = $2::date
     LEFT JOIN open_tasks ot
       ON ot.id = ctot.open_task_id
     WHERE ct.branch_id = $1
       AND ct.date = $2::date
       AND ct.team_key = $3
       AND ct.target_type = 'client'
       AND ct.target_id = ANY($4::int[])
     GROUP BY ct.id
     ORDER BY ct.updated_at DESC, ct.id DESC`,
    [branchId, date, teamKey, clientIds],
  );

  for (const row of rows) {
    const key = contextKey(
      Number(row.clientId),
      row.workLocationGeoUnitId == null ? null : Number(row.workLocationGeoUnitId),
    );
    if (result.has(key)) continue;
    result.set(key, {
      id: Number(row.id),
      clientId: Number(row.clientId),
      workLocationGeoUnitId: row.workLocationGeoUnitId == null
        ? null
        : Number(row.workLocationGeoUnitId),
      status: row.status,
      closingReason: row.closingReason ?? null,
      itemCount: Number(row.itemCount ?? 0),
      committedTaskCount: Number(row.committedTaskCount ?? 0),
    });
  }
  return result;
}

function matchesTaskFilters(
  task: WorkScopeTask,
  filters: PlanningDashboardFilters,
  date: string,
  contextSearchMatch: boolean,
): boolean {
  const q = filters.q?.toLocaleLowerCase('ar');
  if (q && !contextSearchMatch) {
    const taskHaystacks = [
      String(task.openTaskId),
      task.taskType,
      task.taskTypeLabel,
      task.taskFamily,
      task.notes ?? '',
    ];
    if (!taskHaystacks.some(value => value.toLocaleLowerCase('ar').includes(q))) return false;
  }
  if (filters.taskIds?.length && !filters.taskIds.includes(Number(task.openTaskId))) return false;
  if (filters.taskTypes?.length && !filters.taskTypes.includes(task.taskType)) return false;
  if (filters.taskFamilies?.length && !filters.taskFamilies.includes(task.taskFamily)) return false;
  if (filters.taskStatuses?.length && !filters.taskStatuses.includes(task.status)) return false;
  if (filters.priorities?.length && !filters.priorities.includes(task.priority ?? '')) return false;
  if (filters.attemptsMin != null && task.attemptCount < filters.attemptsMin) return false;
  if (filters.dueState && dueState(task, date) !== filters.dueState) return false;
  return true;
}

function matchesExclusionFilter(
  row: PlanningContactRow,
  filters: PlanningDashboardFilters,
): boolean {
  if (!filters.exclusionLayers?.length) return true;
  return filters.exclusionLayers.some(layer => {
    if (layer === 'CLIENT_DO_NOT_CONTACT') return row.contactBlocks.doNotContact;
    if (layer === 'ALL_TEAMS_DAY') return row.tasks.some(task => task.blocks.allTeamsDay);
    if (layer === 'TEAM_DAY') return row.tasks.some(task => task.blocks.currentTeamDay);
    return !row.contactBlocks.doNotContact
      && !row.contactBlocks.cooldownUntil
      && row.tasks.every(task => !task.blocks.allTeamsDay && !task.blocks.currentTeamDay);
  });
}

function sortRows(
  rows: PlanningContactRow[],
  sortBy: string,
  sortDir: 'asc' | 'desc',
): PlanningContactRow[] {
  const direction = sortDir === 'desc' ? -1 : 1;
  const value = (row: PlanningContactRow): string | number => {
    if (sortBy === 'taskCount') return row.counts.totalTasks;
    if (sortBy === 'attemptCount') {
      return row.tasks.reduce((sum, task) => sum + task.attemptCount, 0);
    }
    if (sortBy === 'station') return row.workLocationName ?? '';
    if (sortBy === 'status') return row.lifecycleStatus;
    if (sortBy === 'clientId') return row.clientId;
    return row.clientName;
  };

  return [...rows].sort((left, right) => {
    const a = value(left);
    const b = value(right);
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
    return String(a).localeCompare(String(b), 'ar', { numeric: true }) * direction;
  });
}

async function buildDashboard(params: {
  authContext: AuthContext;
  date: string;
  teamKey: string;
  branchId: number;
  filters?: PlanningDashboardFilters;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  db?: Queryable;
}): Promise<BuiltDashboard> {
  const {
    authContext,
    date,
    teamKey,
    branchId,
    sortBy = 'clientName',
    sortDir = 'asc',
    db = pool,
  } = params;
  validateContext(date, teamKey, branchId);
  await assertPlanningSubject(authContext, date, teamKey, branchId, db);
  const filters = normalizePlanningDashboardFilters(params.filters);

  const [{ rows: listRows }, scope, teamSnapshot] = await Promise.all([
    db.query(
      `SELECT id, created_at AS "createdAt"
         FROM telemarketing_task_lists
        WHERE branch_id = $1
          AND date = $2
          AND team_key = $3
        ORDER BY created_at ASC
        LIMIT 1`,
      [branchId, date, teamKey],
    ),
    getPlanningWorkScope({
      date,
      teamKey,
      branchId,
      includeExcluded: true,
      includeContactBlocked: true,
      includeCommittedSnapshot: true,
      maxTasks: DASHBOARD_SCOPE_TASK_LIMIT + 1,
      db,
    }),
    loadTeamSnapshot(db, date, teamKey),
  ]);
  if (scope.tasks.length > DASHBOARD_SCOPE_TASK_LIMIT) {
    throw new PlanningCurationError(
      'نطاق التخطيط كبير جداً لعرضه دفعة واحدة؛ ضيّق خط السير أو قسّم العمل على فرق إضافية',
      422,
      'DASHBOARD_SCOPE_TOO_LARGE',
      { maxTasks: DASHBOARD_SCOPE_TASK_LIMIT },
    );
  }
  const planState: 'PRE_GENERATION' | 'COMMITTED' =
    listRows.length > 0 ? 'COMMITTED' : 'PRE_GENERATION';
  const generatedAt = listRows[0]?.createdAt ?? null;

  const tasksByContext = new Map<string, WorkScopeTask[]>();
  for (const task of scope.tasks) {
    const key = contextKey(task.clientId, task.effectiveZoneId);
    if (!tasksByContext.has(key)) tasksByContext.set(key, []);
    tasksByContext.get(key)!.push(task);
  }

  const clientIds = Array.from(new Set(scope.tasks.map(task => Number(task.clientId))));
  const targetByContext = await loadContactTargetMeta(
    db,
    branchId,
    date,
    teamKey,
    clientIds,
  );

  const allRows: PlanningContactRow[] = [];
  const filteredRows: PlanningContactRow[] = [];

  for (const [, contextTasks] of tasksByContext) {
    const first = contextTasks[0];
    if (!first) continue;
    const target = targetByContext.get(contextKey(first.clientId, first.effectiveZoneId)) ?? null;
    const lifecycleStatus = lifecycleFromTarget(target);
    const q = filters.q?.toLocaleLowerCase('ar');
    const contextSearchMatch = !q || [
      String(first.clientId),
      first.clientName,
      first.clientMobile ?? '',
      first.effectiveZoneName ?? '',
      first.ownerLabel,
    ].some(value => value.toLocaleLowerCase('ar').includes(q));

    const tasks = contextTasks.map(task => {
      const mapped = makeTask(task, date);
      mapped.matchesTaskFilters = matchesTaskFilters(task, filters, date, contextSearchMatch);
      return mapped;
    });
    const activeCooldown = isCooldownActive(first.clientCooldownUntil, date)
      ? first.clientCooldownUntil
      : null;
    const row: PlanningContactRow = {
      rowKey: opaqueRowKey(first.clientId, first.effectiveZoneId, date),
      clientId: first.clientId,
      clientName: first.clientName,
      primaryPhone: first.clientMobile,
      classification: first.candidateStatus,
      ownershipType: first.ownershipType,
      ownerLabel: first.ownerLabel,
      workLocationGeoUnitId: first.effectiveZoneId,
      workLocationName: first.effectiveZoneName ?? first.clientNeighborhood,
      lifecycleStatus,
      contactTarget: target
        ? { id: target.id, status: target.status, closingReason: target.closingReason }
        : null,
      listState: {
        generated: target != null && target.itemCount > 0,
        itemCount: target?.itemCount ?? 0,
        committedTaskCount: target?.committedTaskCount ?? 0,
      },
      contactBlocks: {
        doNotContact: first.clientDoNotContact,
        cooldownUntil: activeCooldown,
      },
      counts: {
        totalTasks: tasks.length,
        matchingTasks: tasks.filter(task => task.matchesTaskFilters).length,
        actionableTasks: tasks.filter(task => task.availableActions.length > 0).length,
      },
      tasks,
    };
    allRows.push(row);

    if (filters.lifecycleStatuses?.length && !filters.lifecycleStatuses.includes(lifecycleStatus)) {
      continue;
    }
    if (
      filters.stationIds?.length
      && (row.workLocationGeoUnitId == null
        || !filters.stationIds.includes(row.workLocationGeoUnitId))
    ) {
      continue;
    }
    if (filters.classifications?.length && !filters.classifications.includes(row.classification ?? '')) {
      continue;
    }
    if (filters.ownershipTypes?.length && !filters.ownershipTypes.includes(row.ownershipType)) {
      continue;
    }
    if (filters.phoneState === 'VALID' && !row.primaryPhone) continue;
    if (filters.phoneState === 'MISSING' && row.primaryPhone) continue;
    if (filters.minTaskCount != null && row.counts.totalTasks < filters.minTaskCount) continue;
    if (filters.maxTaskCount != null && row.counts.totalTasks > filters.maxTaskCount) continue;
    if (!matchesExclusionFilter(row, filters)) continue;
    if (row.counts.matchingTasks === 0) continue;
    filteredRows.push(row);
  }

  const sortedRows = sortRows(filteredRows, sortBy, sortDir);
  const queryFingerprint = hashValue({
    branchId,
    date,
    teamKey,
    teamSnapshot,
    filters,
    rows: [...filteredRows]
      .sort((left, right) => left.rowKey.localeCompare(right.rowKey))
      .map(row => ({
      rowKey: row.rowKey,
      lifecycleStatus: row.lifecycleStatus,
      tasks: [...row.tasks]
        .sort((left, right) => left.taskId - right.taskId)
        .map(taskStateFingerprint),
    })),
  });

  const stationFacetMap = new Map<number, { label: string; rows: Set<string> }>();
  const taskTypeFacetMap = new Map<string, { label: string; rows: Set<string> }>();
  const familyFacetMap = new Map<string, Set<string>>();
  const priorityFacetMap = new Map<string, Set<string>>();
  for (const row of allRows) {
    if (row.workLocationGeoUnitId != null) {
      if (!stationFacetMap.has(row.workLocationGeoUnitId)) {
        stationFacetMap.set(row.workLocationGeoUnitId, {
          label: row.workLocationName ?? `#${row.workLocationGeoUnitId}`,
          rows: new Set(),
        });
      }
      stationFacetMap.get(row.workLocationGeoUnitId)!.rows.add(row.rowKey);
    }
    for (const task of row.tasks) {
      if (!taskTypeFacetMap.has(task.taskType)) {
        taskTypeFacetMap.set(task.taskType, { label: task.taskTypeLabel, rows: new Set() });
      }
      taskTypeFacetMap.get(task.taskType)!.rows.add(row.rowKey);
      if (!familyFacetMap.has(task.taskFamily)) familyFacetMap.set(task.taskFamily, new Set());
      familyFacetMap.get(task.taskFamily)!.add(row.rowKey);
      if (task.priority) {
        if (!priorityFacetMap.has(task.priority)) priorityFacetMap.set(task.priority, new Set());
        priorityFacetMap.get(task.priority)!.add(row.rowKey);
      }
    }
  }

  return {
    date,
    teamKey,
    planState,
    generatedAt,
    allRows,
    filteredRows: sortedRows,
    summary: {
      contacts: sortedRows.length,
      tasks: sortedRows.reduce((sum, row) => sum + row.counts.totalTasks, 0),
      matchingTasks: sortedRows.reduce((sum, row) => sum + row.counts.matchingTasks, 0),
      actionableTasks: sortedRows.reduce((sum, row) => sum + row.counts.actionableTasks, 0),
      matchingActionableTasks: sortedRows.reduce(
        (sum, row) => sum + row.tasks.filter(
          task => task.matchesTaskFilters && task.availableActions.length > 0,
        ).length,
        0,
      ),
      ready: sortedRows.filter(row => row.lifecycleStatus === 'ready').length,
      queued: sortedRows.filter(row => row.lifecycleStatus === 'queued').length,
      contacted: sortedRows.filter(row => row.lifecycleStatus === 'contacted').length,
      closed: sortedRows.filter(row => row.lifecycleStatus === 'closed').length,
      excludedTeamDay: sortedRows.reduce(
        (sum, row) => sum + row.tasks.filter(task => task.blocks.currentTeamDay).length,
        0,
      ),
      excludedAllTeamsDay: sortedRows.reduce(
        (sum, row) => sum + row.tasks.filter(task => task.blocks.allTeamsDay).length,
        0,
      ),
      blockedCustomers: sortedRows.filter(
        row => row.contactBlocks.doNotContact || row.contactBlocks.cooldownUntil != null,
      ).length,
    },
    facets: {
      stations: [...stationFacetMap.entries()]
        .map(([value, item]) => ({ value, label: item.label, count: item.rows.size }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ar')),
      taskTypes: [...taskTypeFacetMap.entries()]
        .map(([value, item]) => ({ value, label: item.label, count: item.rows.size }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ar')),
      taskFamilies: [...familyFacetMap.entries()]
        .map(([value, rows]) => ({ value, label: value, count: rows.size }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ar')),
      priorities: [...priorityFacetMap.entries()]
        .map(([value, rows]) => ({ value, label: value, count: rows.size }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ar')),
    },
    queryFingerprint,
  };
}

export async function getPlanningCurationDashboard(params: {
  authContext: AuthContext;
  date: string;
  teamKey: string;
  branchId: number;
  filters?: PlanningDashboardFilters;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}): Promise<PlanningDashboardResponse> {
  const page = boundedInteger(params.page, 1, 1_000_000) ?? 1;
  const limit = boundedInteger(params.limit, 10, 100) ?? 50;
  const built = await buildDashboard(params);
  const totalContacts = built.filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalContacts / limit));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * limit;

  return {
    date: built.date,
    teamKey: built.teamKey,
    planState: built.planState,
    generatedAt: built.generatedAt,
    rows: built.filteredRows.slice(offset, offset + limit),
    pagination: {
      page: safePage,
      limit,
      totalContacts,
      totalPages,
    },
    summary: built.summary,
    facets: built.facets,
    queryFingerprint: built.queryFingerprint,
  };
}

export function normalizePlanningCurationSelector(
  selector: PlanningCurationSelector,
): PlanningCurationSelector {
  if (selector?.kind === 'TASK_IDS') {
    const taskIds = uniquePositiveIntegers(selector.taskIds);
    if (taskIds.length === 0 || taskIds.length > 1_000) {
      throw new PlanningCurationError(
        'يجب تحديد مهمة واحدة على الأقل وبحد أقصى 1000 مهمة صريحة',
        400,
        'INVALID_TASK_SELECTOR',
      );
    }
    return { kind: 'TASK_IDS', taskIds };
  }
  if (selector?.kind === 'CONTACT_KEYS') {
    const contactKeys = uniqueStrings(selector.contactKeys);
    if (contactKeys.length === 0 || contactKeys.length > 1_000) {
      throw new PlanningCurationError(
        'يجب تحديد جهة اتصال واحدة على الأقل وبحد أقصى 1000 جهة اتصال صريحة',
        400,
        'INVALID_CONTACT_SELECTOR',
      );
    }
    return { kind: 'CONTACT_KEYS', contactKeys };
  }
  if (selector?.kind === 'FILTERED_SET') {
    if (!['MATCHING_TASKS', 'ALL_TASKS_OF_MATCHED_CONTACTS', 'NON_MATCHING_TASKS_OF_MATCHED_CONTACTS']
      .includes(selector.targetMode)) {
      throw new PlanningCurationError('نمط الاستهداف غير صالح', 400, 'INVALID_TARGET_MODE');
    }
    if (
      typeof selector.queryFingerprint !== 'string'
      || !/^[a-f0-9]{64}$/i.test(selector.queryFingerprint)
    ) {
      throw new PlanningCurationError('بصمة نتائج الفلتر مفقودة', 400, 'QUERY_FINGERPRINT_REQUIRED');
    }
    return {
      kind: 'FILTERED_SET',
      filters: normalizePlanningDashboardFilters(selector.filters),
      queryFingerprint: selector.queryFingerprint,
      targetMode: selector.targetMode,
      exceptTaskIds: uniquePositiveIntegers(selector.exceptTaskIds),
      exceptContactKeys: uniqueStrings(selector.exceptContactKeys),
    };
  }
  throw new PlanningCurationError('محدد العناصر غير صالح', 400, 'INVALID_SELECTOR');
}

async function resolveSelection(params: {
  authContext: AuthContext;
  date: string;
  teamKey: string;
  branchId: number;
  selector: PlanningCurationSelector;
  action?: PlanningCurationAction;
  layer?: PlanningExclusionLayer;
  db?: Queryable;
}): Promise<ResolvedSelection> {
  const selector = normalizePlanningCurationSelector(params.selector);
  const filters = selector.kind === 'FILTERED_SET' ? selector.filters : {};
  const built = await buildDashboard({ ...params, filters, db: params.db });
  let rows: PlanningContactRow[];
  let tasks: PlanningContactTask[];
  let skippedUnavailableTasks = 0;

  if (selector.kind === 'TASK_IDS') {
    const wanted = new Set(selector.taskIds);
    rows = built.allRows.filter(row => row.tasks.some(task => wanted.has(task.taskId)));
    tasks = rows.flatMap(row => row.tasks.filter(task => wanted.has(task.taskId)));
    if (tasks.length !== wanted.size) {
      throw new PlanningCurationError(
        'بعض المهام لم تعد ضمن نطاق هذا الفريق واليوم',
        409,
        'SELECTION_CHANGED',
      );
    }
  } else if (selector.kind === 'CONTACT_KEYS') {
    const wanted = new Set(selector.contactKeys);
    rows = built.allRows.filter(row => wanted.has(row.rowKey));
    if (rows.length !== wanted.size) {
      throw new PlanningCurationError(
        'بعض جهات الاتصال لم تعد ضمن نطاق هذا الفريق واليوم',
        409,
        'SELECTION_CHANGED',
      );
    }
    tasks = rows.flatMap(row => row.tasks);
  } else {
    if (built.queryFingerprint !== selector.queryFingerprint) {
      throw new PlanningCurationError(
        'تغيرت نتائج الفلاتر؛ أعد المعاينة قبل التطبيق',
        409,
        'PREVIEW_STALE',
      );
    }
    const excludedContacts = new Set(selector.exceptContactKeys);
    const excludedTasks = new Set(selector.exceptTaskIds);
    rows = built.filteredRows.filter(row => !excludedContacts.has(row.rowKey));
    const selectedByMode = rows.flatMap(row => {
      const candidates = selector.targetMode === 'MATCHING_TASKS'
        ? row.tasks.filter(task => task.matchesTaskFilters)
        : selector.targetMode === 'NON_MATCHING_TASKS_OF_MATCHED_CONTACTS'
          ? row.tasks.filter(task => !task.matchesTaskFilters)
          : row.tasks;
      return candidates.filter(task => !excludedTasks.has(task.taskId));
    });
    if (params.action && params.layer) {
      const filtered = filterPlanningCurationTasksForAction(
        selectedByMode,
        params.action,
        params.layer,
      );
      tasks = filtered.tasks;
      skippedUnavailableTasks = filtered.skippedUnavailableTasks;
    } else {
      tasks = selectedByMode;
    }
  }

  const uniqueTasks = Array.from(new Map(tasks.map(task => [task.taskId, task])).values())
    .sort((a, b) => a.taskId - b.taskId);
  if (uniqueTasks.length === 0) {
    throw new PlanningCurationError(
      'لا توجد مهام مطابقة لنمط الاستهداف',
      409,
      'EMPTY_SELECTION',
    );
  }
  const selectedTaskIds = new Set(uniqueTasks.map(task => task.taskId));
  const selectedClientIds = new Set(uniqueTasks.map(task => task.clientId));
  const isClientAction = params.layer === 'CLIENT_DO_NOT_CONTACT'
    || params.action === 'SET_DO_NOT_CONTACT'
    || params.action === 'CLEAR_DO_NOT_CONTACT';
  rows = isClientAction
    ? built.allRows.filter(row => selectedClientIds.has(row.clientId))
    : rows.filter(row =>
        row.tasks.some(task => selectedTaskIds.has(task.taskId)));

  const tasksByClient = new Map<number, string[]>();
  for (const row of rows) {
    if (!selectedClientIds.has(row.clientId)) continue;
    if (!tasksByClient.has(row.clientId)) tasksByClient.set(row.clientId, []);
    tasksByClient.get(row.clientId)!.push(row.rowKey);
  }
  const contacts = [...tasksByClient.entries()].map(([clientId, rowKeys]) => ({
    clientId,
    rowKeys: [...new Set(rowKeys)].sort(),
  }));

  return {
    built,
    rows,
    tasks: uniqueTasks,
    contacts,
    selectionFingerprint: hashValue(uniqueTasks.map(taskStateFingerprint)),
    skippedUnavailableTasks,
  };
}

type CurationPreviewTokenPayload = jwt.JwtPayload & {
  type: 'planning_curation_preview';
  userId: number;
  branchId: number;
  date: string;
  teamKey: string;
  action: PlanningCurationAction;
  layer: PlanningExclusionLayer;
  selector: PlanningCurationSelector;
  reasonCode: string;
  reasonText: string | null;
  queryFingerprint: string;
  selectionFingerprint: string;
};

function normalizeReason(
  action: PlanningCurationAction,
  reasonCodeValue: unknown,
  reasonTextValue: unknown,
): { reasonCode: string; reasonText: string | null } {
  const reasonCode = typeof reasonCodeValue === 'string'
    && /^[a-z0-9_]{1,50}$/i.test(reasonCodeValue.trim())
    ? reasonCodeValue.trim()
    : 'manual';
  const reasonText = typeof reasonTextValue === 'string'
    ? reasonTextValue.trim().slice(0, 500) || null
    : null;
  if (
    ['EXCLUDE', 'SET_DO_NOT_CONTACT', 'CLEAR_DO_NOT_CONTACT'].includes(action)
    && !reasonText
  ) {
    throw new PlanningCurationError(
      'سبب القرار مطلوب قبل المعاينة',
      400,
      'REASON_REQUIRED',
    );
  }
  return { reasonCode, reasonText };
}

function validateActionLayer(
  action: PlanningCurationAction,
  layer: PlanningExclusionLayer,
) {
  const taskAction = action === 'EXCLUDE' || action === 'RESTORE';
  const contactAction = action === 'SET_DO_NOT_CONTACT' || action === 'CLEAR_DO_NOT_CONTACT';
  if (taskAction && !['TEAM_DAY', 'ALL_TEAMS_DAY'].includes(layer)) {
    throw new PlanningCurationError(
      'إجراء المهمة يتطلب طبقة يومية خاصة بالفريق أو بكل الفرق',
      400,
      'ACTION_LAYER_MISMATCH',
    );
  }
  if (contactAction && layer !== 'CLIENT_DO_NOT_CONTACT') {
    throw new PlanningCurationError(
      'قرار عدم التواصل يطبق على الزبون، لا على مهمة مفردة',
      400,
      'ACTION_LAYER_MISMATCH',
    );
  }
}

async function assertClientContactControlScope(
  authContext: AuthContext,
  clientIds: number[],
  db: Queryable = pool,
  lock = false,
): Promise<void> {
  if (clientIds.length === 0) return;
  const { rows } = await db.query(
    `SELECT
       c.id,
       c.branch_id AS "branchId",
       COALESCE(
         (
           SELECT array_agg(ca.hr_user_id ORDER BY ca.hr_user_id)
             FROM client_assignments ca
             JOIN hr_users assigned_user ON assigned_user.id = ca.hr_user_id
             LEFT JOIN roles assigned_role ON assigned_role.id = assigned_user.role_id
             LEFT JOIN employees assigned_employee
               ON assigned_employee.id = assigned_user.employee_id
            WHERE ca.client_id = c.id
              AND ${eligiblePersonalOwnerCondition(
                'assigned_user',
                'assigned_role',
                'assigned_employee',
              )}
         ),
         '{}'::int[]
       ) AS "assignedUserIds"
      FROM clients c
      WHERE c.id = ANY($1::int[])
      ORDER BY c.id
      ${lock ? 'FOR UPDATE OF c' : ''}`,
    [clientIds],
  );
  if (rows.length !== clientIds.length) {
    throw new PlanningCurationError(
      'بعض الزبائن لم يعودوا موجودين',
      409,
      'SELECTION_CHANGED',
    );
  }
  for (const row of rows) {
    const access = canEditClientContactControl(authContext, {
      branchId: row.branchId == null ? null : Number(row.branchId),
      assignedUserIds: Array.isArray(row.assignedUserIds)
        ? row.assignedUserIds.map(Number)
        : [],
    });
    if (!access.allowed) {
      throw new PlanningCurationError(
        'ليس لديك صلاحية تغيير عدم التواصل لبعض الزبائن المحددين',
        403,
        access.reason ?? 'CLIENT_CONTACT_CONTROL_FORBIDDEN',
      );
    }
  }
}

function isLayerApplied(task: PlanningContactTask, layer: PlanningExclusionLayer): boolean {
  if (layer === 'TEAM_DAY') return task.blocks.currentTeamDay;
  if (layer === 'ALL_TEAMS_DAY') return task.blocks.allTeamsDay;
  return task.blocks.clientDoNotContact;
}

function countFullyExcludedContacts(
  selection: ResolvedSelection,
  action: PlanningCurationAction,
  layer: PlanningExclusionLayer,
): number {
  const selectedTaskIds = new Set(selection.tasks.map(task => task.taskId));
  const selectedClientIds = new Set(selection.contacts.map(contact => contact.clientId));
  const affectedRows = layer === 'CLIENT_DO_NOT_CONTACT'
    ? selection.built.allRows.filter(row => selectedClientIds.has(row.clientId))
    : selection.rows;
  return affectedRows.filter(row => {
    const hasAvailableAfter = row.tasks.some(task => {
      let globalBlocked = task.blocks.allTeamsDay;
      let teamBlocked = task.blocks.currentTeamDay;
      let contactBlocked = task.blocks.clientDoNotContact || task.blocks.clientCooldown;
      if (
        selectedTaskIds.has(task.taskId)
        || (layer === 'CLIENT_DO_NOT_CONTACT' && selectedClientIds.has(task.clientId))
      ) {
        if (layer === 'ALL_TEAMS_DAY') globalBlocked = action === 'EXCLUDE';
        if (layer === 'TEAM_DAY') teamBlocked = action === 'EXCLUDE';
        if (layer === 'CLIENT_DO_NOT_CONTACT') {
          contactBlocked = action === 'SET_DO_NOT_CONTACT' || task.blocks.clientCooldown;
        }
      }
      return EXCLUDABLE_STATES.has(task.status)
        && !globalBlocked
        && !teamBlocked
        && !contactBlocked;
    });
    return !hasAvailableAfter;
  }).length;
}

async function loadClientContactControlImpact(
  db: Queryable,
  clientIds: number[],
): Promise<{
  affectedTasks: number;
  releasedAssignments: number;
  closedTargets: number;
}> {
  if (clientIds.length === 0) {
    return { affectedTasks: 0, releasedAssignments: 0, closedTargets: 0 };
  }
  const { rows } = await db.query(
    `SELECT
       (
         SELECT COUNT(*)::int
           FROM open_tasks affected_task
          WHERE affected_task.client_id = ANY($1::int[])
       ) AS "affectedTasks",
       (
         SELECT COUNT(*)::int
           FROM open_tasks releasable_task
          WHERE releasable_task.client_id = ANY($1::int[])
            AND releasable_task.status = 'assigned'
       ) AS "releasedAssignments",
       (
         SELECT COUNT(*)::int
           FROM contact_targets active_target
          WHERE active_target.target_type = 'client'
            AND active_target.target_id = ANY($1::int[])
            AND active_target.status IN ('new', 'queued', 'in_call_list', 'contacted')
       ) AS "closedTargets"`,
    [clientIds],
  );
  return {
    affectedTasks: Number(rows[0]?.affectedTasks ?? 0),
    releasedAssignments: Number(rows[0]?.releasedAssignments ?? 0),
    closedTargets: Number(rows[0]?.closedTargets ?? 0),
  };
}

export async function previewPlanningCuration(params: {
  authContext: AuthContext;
  date: string;
  teamKey: string;
  branchId: number;
  action: PlanningCurationAction;
  layer: PlanningExclusionLayer;
  selector: PlanningCurationSelector;
  reasonCode?: string;
  reasonText?: string;
}) {
  validateContext(params.date, params.teamKey, params.branchId);
  validateActionLayer(params.action, params.layer);
  const { reasonCode, reasonText } = normalizeReason(
    params.action,
    params.reasonCode,
    params.reasonText,
  );
  const selector = normalizePlanningCurationSelector(params.selector);
  const selection = await resolveSelection({
    ...params,
    selector,
    action: params.action,
    layer: params.layer,
  });
  const isContactAction = params.layer === 'CLIENT_DO_NOT_CONTACT';
  if (isContactAction) {
    await assertClientContactControlScope(
      params.authContext,
      selection.contacts.map(contact => contact.clientId),
    );
  }

  const committedConflicts = !isContactAction
    ? selection.tasks.filter(task => task.assignment.committed)
    : [];
  const alreadyApplied = isContactAction
    ? selection.contacts.filter(contact => {
        const row = selection.rows.find(item => item.clientId === contact.clientId);
        return params.action === 'SET_DO_NOT_CONTACT'
          ? row?.contactBlocks.doNotContact === true
          : row?.contactBlocks.doNotContact !== true;
      }).length
    : selection.tasks.filter(task => {
        const applied = isLayerApplied(task, params.layer);
        return params.action === 'EXCLUDE' ? applied : !applied;
      }).length;

  let releasedAssignments = 0;
  let closedTargets = 0;
  let affectedTasks = Math.max(
    0,
    (isContactAction ? selection.contacts.length : selection.tasks.length) - alreadyApplied,
  );
  if (params.action === 'EXCLUDE' && params.layer === 'TEAM_DAY') {
    releasedAssignments = selection.tasks.filter(task =>
      task.status === 'assigned'
      && task.assignment.teamKey === params.teamKey
      && task.assignment.date?.slice(0, 10) === params.date,
    ).length;
  } else if (params.action === 'EXCLUDE' && params.layer === 'ALL_TEAMS_DAY') {
    releasedAssignments = selection.tasks.filter(task =>
      task.status === 'assigned' && task.assignment.date?.slice(0, 10) === params.date,
    ).length;
  } else if (params.action === 'SET_DO_NOT_CONTACT') {
    const impact = await loadClientContactControlImpact(
      pool,
      selection.contacts.map(contact => contact.clientId),
    );
    affectedTasks = impact.affectedTasks;
    releasedAssignments = impact.releasedAssignments;
    closedTargets = impact.closedTargets;
  } else if (params.action === 'CLEAR_DO_NOT_CONTACT') {
    const impact = await loadClientContactControlImpact(
      pool,
      selection.contacts.map(contact => contact.clientId),
    );
    affectedTasks = impact.affectedTasks;
  }

  const warnings: string[] = [];
  if (params.layer === 'CLIENT_DO_NOT_CONTACT') {
    warnings.push('عدم التواصل قرار دائم على الزبون ويؤثر في كل مهامه وفرق العمل حتى إلغائه.');
  }
  if (params.layer === 'TEAM_DAY') {
    warnings.push('القرار يخص هذا الفريق واليوم فقط؛ ولا يسمح بتقسيم جهة الاتصال نفسها بين فريقين.');
  }
  if (committedConflicts.length > 0) {
    warnings.push('تتضمن المجموعة مهام معتمدة بعد التوليد؛ لن يسمح الخادم بتطبيق الدفعة.');
  }
  if (selection.skippedUnavailableTasks > 0) {
    warnings.push(
      `تم تجاوز ${selection.skippedUnavailableTasks} مهمة معتمدة أو غير قابلة لهذا الإجراء؛ ستطبق الدفعة على المهام المتاحة فقط.`,
    );
  }

  const issuedAtMs = Date.now();
  const tokenPayload: Omit<CurationPreviewTokenPayload, keyof jwt.JwtPayload> & Record<string, unknown> = {
    type: 'planning_curation_preview',
    userId: params.authContext.userId,
    branchId: params.branchId,
    date: params.date,
    teamKey: params.teamKey,
    action: params.action,
    layer: params.layer,
    selector,
    reasonCode,
    reasonText,
    queryFingerprint: selection.built.queryFingerprint,
    selectionFingerprint: selection.selectionFingerprint,
  };
  const previewToken = jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: '5m',
    audience: CURATION_TOKEN_AUDIENCE,
    issuer: CURATION_TOKEN_ISSUER,
  });

  return {
    previewToken,
    expiresAt: new Date(issuedAtMs + 5 * 60_000).toISOString(),
    canApply: committedConflicts.length === 0,
    counts: {
      contacts: selection.contacts.length,
      selectedTasks: selection.tasks.length,
      affectedTasks,
      releasedAssignments,
      closedTargets,
      contactsFullyExcluded: countFullyExcludedContacts(selection, params.action, params.layer),
      alreadyApplied,
      committedConflicts: committedConflicts.length,
      skippedUnavailableTasks: selection.skippedUnavailableTasks,
    },
    warnings,
    sample: selection.rows.slice(0, 10).map(row => ({
      rowKey: row.rowKey,
      clientId: row.clientId,
      clientName: row.clientName,
      taskCount: row.counts.totalTasks,
      selectedTaskCount: selection.tasks.filter(task => task.clientId === row.clientId).length,
    })),
  };
}

async function acquirePlanningMutationLock(
  db: Queryable,
  branchId: number,
  date: string,
) {
  await lockPlanningScheduleMutation(db, date);
  await db.query(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    [`planning:${branchId}:${date}`],
  );
}

export async function lockPlanningScheduleMutation(
  db: Queryable,
  date: string,
) {
  await db.query(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    [`planning-schedule:${date}`],
  );
}

async function loadTeamSnapshot(
  db: Queryable,
  date: string,
  teamKey: string,
): Promise<Record<string, unknown>> {
  const match = teamKey.match(/^(team|solo)_(\d+)$/);
  if (!match) throw new PlanningCurationError('teamKey غير صالح', 400, 'INVALID_TEAM_KEY');
  const { rows } = await db.query(
    'SELECT teams, solos FROM day_schedules WHERE date = $1',
    [date],
  );
  const slots = match[1] === 'team' ? rows[0]?.teams : rows[0]?.solos;
  const slot = Array.isArray(slots) ? slots[Number(match[2])] : null;
  if (!slot || typeof slot !== 'object') {
    throw new PlanningCurationError(
      'الفريق غير موجود في جدول هذا اليوم',
      409,
      'TEAM_SUBJECT_CHANGED',
    );
  }
  return JSON.parse(JSON.stringify(slot)) as Record<string, unknown>;
}

async function loadLockedSelectionState(
  db: Queryable,
  taskIds: number[],
  branchId: number,
  date: string,
  teamKey: string,
) {
  const { rows } = await db.query(
    `SELECT
       ot.id,
       ot.client_id AS "clientId",
       ot.status,
       ot.last_waiting_status AS "lastWaitingStatus",
       ot.assigned_team_key AS "assignedTeamKey",
       ot.assigned_for_date AS "assignedForDate",
       c.do_not_contact AS "clientDoNotContact",
       c.cooldown_until AS "clientCooldownUntil",
       EXISTS (
         SELECT 1
           FROM telemarketing_task_list_items item
           JOIN telemarketing_task_lists task_list
             ON task_list.id = item.task_list_id
          WHERE item.open_task_id = ot.id
            AND task_list.branch_id = ot.branch_id
            AND task_list.date = $3
            AND task_list.team_key = $4
       ) AS "taskCommitted",
       (
         ot.excluded_for_date = $3::date
         OR EXISTS (
           SELECT 1
             FROM planning_task_exclusions pte
            WHERE pte.open_task_id = ot.id
              AND pte.branch_id = ot.branch_id
              AND pte.planning_date = $3::date
              AND pte.exclusion_scope = 'all_teams'
              AND pte.revoked_at IS NULL
         )
       ) AS "allTeamsDayExcluded",
       EXISTS (
         SELECT 1
           FROM planning_task_exclusions pte
          WHERE pte.open_task_id = ot.id
            AND pte.branch_id = ot.branch_id
            AND pte.planning_date = $3::date
            AND pte.exclusion_scope = 'team'
            AND pte.team_key = $4
            AND pte.revoked_at IS NULL
       ) AS "currentTeamDayExcluded"
     FROM open_tasks ot
     JOIN clients c ON c.id = ot.client_id
     WHERE ot.id = ANY($1::int[])
       AND ot.branch_id = $2
     ORDER BY ot.id
     FOR UPDATE OF ot`,
    [taskIds, branchId, date, teamKey],
  );
  return rows;
}

async function lockSelectedClientRows(
  db: Queryable,
  clientIds: number[],
) {
  const ids = uniquePositiveIntegers(clientIds);
  if (ids.length === 0) return;
  const { rowCount } = await db.query(
    `SELECT id
       FROM clients
      WHERE id = ANY($1::int[])
      ORDER BY id
      FOR UPDATE`,
    [ids],
  );
  if (Number(rowCount ?? 0) !== ids.length) {
    throw new PlanningCurationError(
      'تغيرت مجموعة الزبائن قبل التطبيق',
      409,
      'PREVIEW_STALE',
    );
  }
}

function lockedSelectionFingerprint(rows: any[], date: string): string {
  return hashValue(rows.map(row => ({
    id: Number(row.id),
    clientId: Number(row.clientId),
    status: row.status,
    teamKey: row.assignedTeamKey ?? null,
    date: row.assignedForDate == null ? null : String(row.assignedForDate).slice(0, 10),
    allTeamsDay: row.allTeamsDayExcluded === true,
    currentTeamDay: row.currentTeamDayExcluded === true,
    doNotContact: row.clientDoNotContact === true,
    cooldown: isCooldownActive(row.clientCooldownUntil ?? null, date),
    committed: row.taskCommitted === true || COMMITTED_STATES.has(row.status),
  })));
}

async function recordAssignmentReleaseEvents(
  db: Queryable,
  releasedRows: any[],
  userId: number,
  reasonText: string | null,
) {
  if (releasedRows.length === 0) return;
  const ids = releasedRows.map(row => Number(row.id));
  const restoredStatuses = releasedRows.map(row => row.lastWaitingStatus || 'open');
  const oldStatuses = releasedRows.map(row => row.oldStatus ?? row.status ?? 'assigned');
  await db.query(
    `INSERT INTO task_activity_log (
       task_id, event_type, performed_by, role, old_value, new_value, reason
     )
     SELECT
       released.task_id,
       'status_change',
       $4,
       NULL,
       released.old_status,
       released.restored_status,
       $5
     FROM unnest($1::int[], $2::text[], $3::text[])
       AS released(task_id, restored_status, old_status)`,
    [ids, restoredStatuses, oldStatuses, userId, reasonText],
  );
}

async function insertCurationOperation(
  db: Queryable,
  payload: CurationPreviewTokenPayload,
  selection: ResolvedSelection,
  affectedTaskCount = selection.tasks.length,
): Promise<number> {
  const actionMap: Record<PlanningCurationAction, string> = {
    EXCLUDE: 'exclude',
    RESTORE: 'restore',
    SET_DO_NOT_CONTACT: 'set_do_not_contact',
    CLEAR_DO_NOT_CONTACT: 'clear_do_not_contact',
  };
  const layerMap: Record<PlanningExclusionLayer, string> = {
    TEAM_DAY: 'team_day',
    ALL_TEAMS_DAY: 'all_teams_day',
    CLIENT_DO_NOT_CONTACT: 'client_do_not_contact',
  };
  const { rows } = await db.query(
    `INSERT INTO planning_curation_operations (
       branch_id, planning_date, team_key, action, layer, selector,
       query_fingerprint, selection_fingerprint, reason_code, reason_text,
       affected_contacts, affected_tasks, performed_by
     )
     VALUES (
       $1, $2::date, $3, $4, $5, $6::jsonb,
       $7, $8, $9, $10, $11, $12, $13
     )
     RETURNING id`,
    [
      payload.branchId,
      payload.date,
      payload.teamKey,
      actionMap[payload.action],
      layerMap[payload.layer],
      JSON.stringify(payload.selector),
      payload.queryFingerprint,
      payload.selectionFingerprint,
      payload.reasonCode,
      payload.reasonText,
      selection.contacts.length,
      affectedTaskCount,
      payload.userId,
    ],
  );
  return Number(rows[0].id);
}

async function applyTaskExclusion(
  db: Queryable,
  payload: CurationPreviewTokenPayload,
  operationId: number,
  lockedRows: any[],
) {
  const taskIds = lockedRows.map(row => Number(row.id));
  const teamSnapshot = payload.layer === 'TEAM_DAY'
    ? await loadTeamSnapshot(db, payload.date, payload.teamKey)
    : null;
  const scope = payload.layer === 'TEAM_DAY' ? 'team' : 'all_teams';
  const teamKey = payload.layer === 'TEAM_DAY' ? payload.teamKey : null;

  const { rows: insertedExclusions } = await db.query(
    `INSERT INTO planning_task_exclusions (
       open_task_id, branch_id, planning_date, exclusion_scope, team_key,
       team_snapshot, reason_code, reason_text, operation_id, excluded_by
     )
     SELECT
       ot.id, ot.branch_id, $3::date, $4, $5, $6::jsonb, $7, $8, $9, $10
     FROM open_tasks ot
     WHERE ot.id = ANY($1::int[])
       AND ot.branch_id = $2
       AND NOT EXISTS (
         SELECT 1
           FROM planning_task_exclusions active
          WHERE active.open_task_id = ot.id
            AND active.branch_id = ot.branch_id
            AND active.planning_date = $3::date
            AND active.exclusion_scope = $4
            AND active.team_key IS NOT DISTINCT FROM $5
            AND active.revoked_at IS NULL
       )
     RETURNING open_task_id AS id`,
    [
      taskIds,
      payload.branchId,
      payload.date,
      scope,
      teamKey,
      teamSnapshot == null ? null : JSON.stringify(teamSnapshot),
      payload.reasonCode,
      payload.reasonText,
      operationId,
      payload.userId,
    ],
  );

  const releasedRows = lockedRows.filter(row => {
    if (row.status !== 'assigned') return false;
    const assignedDate = row.assignedForDate == null
      ? null
      : String(row.assignedForDate).slice(0, 10);
    if (assignedDate !== payload.date) return false;
    return payload.layer === 'ALL_TEAMS_DAY' || row.assignedTeamKey === payload.teamKey;
  });
  if (releasedRows.length > 0) {
    const releasedIds = releasedRows.map(row => Number(row.id));
    const params: unknown[] = [releasedIds, payload.branchId, payload.date];
    let teamClause = '';
    if (payload.layer === 'TEAM_DAY') {
      params.push(payload.teamKey);
      teamClause = 'AND assigned_team_key = $4';
    }
    await db.query(
      `UPDATE open_tasks
          SET status = COALESCE(last_waiting_status, 'open'),
              assigned_scope_id = NULL,
              assigned_team_key = NULL,
              assigned_for_date = NULL,
              assigned_at = NULL,
              updated_at = NOW()
        WHERE id = ANY($1::int[])
          AND branch_id = $2
          AND status = 'assigned'
          AND assigned_for_date = $3::date
          ${teamClause}`,
      params,
    );
    await recordAssignmentReleaseEvents(
      db,
      releasedRows,
      payload.userId,
      payload.reasonText,
    );
  }

  if (payload.layer === 'ALL_TEAMS_DAY') {
    const insertedTaskIds = insertedExclusions.map(row => Number(row.id));
    if (insertedTaskIds.length > 0) {
    await db.query(
      `UPDATE open_tasks
          SET excluded_for_date = $1::date,
              excluded_reason = $2,
              updated_at = NOW()
        WHERE id = ANY($3::int[])
          AND branch_id = $4`,
        [payload.date, payload.reasonText, insertedTaskIds, payload.branchId],
    );
    }
  }

  await db.query(
    `UPDATE contact_target_open_tasks ctot
        SET link_status = 'excluded',
            updated_at = NOW()
      WHERE ctot.open_task_id = ANY($1::int[])
        AND ctot.branch_id = $2
        AND ctot.date = $3::date
        AND ($4::boolean OR ctot.team_key = $5)`,
    [
      taskIds,
      payload.branchId,
      payload.date,
      payload.layer === 'ALL_TEAMS_DAY',
      payload.teamKey,
    ],
  );
  return releasedRows.length;
}

async function applyTaskRestore(
  db: Queryable,
  payload: CurationPreviewTokenPayload,
  operationId: number,
  lockedRows: any[],
) {
  const taskIds = lockedRows.map(row => Number(row.id));
  const scope = payload.layer === 'TEAM_DAY' ? 'team' : 'all_teams';
  const teamKey = payload.layer === 'TEAM_DAY' ? payload.teamKey : null;
  const { rowCount } = await db.query(
    `UPDATE planning_task_exclusions
        SET revoked_at = NOW(),
            revoked_by = $1,
            revoke_reason = $2,
            revoked_operation_id = $3
      WHERE open_task_id = ANY($4::int[])
        AND branch_id = $5
        AND planning_date = $6::date
        AND exclusion_scope = $7
        AND team_key IS NOT DISTINCT FROM $8
        AND revoked_at IS NULL`,
    [
      payload.userId,
      payload.reasonText,
      operationId,
      taskIds,
      payload.branchId,
      payload.date,
      scope,
      teamKey,
    ],
  );

  if (payload.layer === 'ALL_TEAMS_DAY') {
    await db.query(
      `UPDATE open_tasks
          SET excluded_for_date = NULL,
              excluded_reason = NULL,
              updated_at = NOW()
        WHERE id = ANY($1::int[])
          AND branch_id = $2
          AND excluded_for_date = $3::date`,
      [taskIds, payload.branchId, payload.date],
    );
  }

  await db.query(
    `UPDATE contact_target_open_tasks ctot
        SET link_status = 'ready',
            updated_at = NOW()
       FROM contact_targets ct
      WHERE ctot.contact_target_id = ct.id
        AND ctot.open_task_id = ANY($1::int[])
        AND ctot.branch_id = $2
        AND ctot.date = $3::date
        AND ($4::boolean OR ctot.team_key = $5)
        AND ct.status = 'new'
        AND NOT EXISTS (
          SELECT 1
            FROM planning_task_exclusions active
           WHERE active.open_task_id = ctot.open_task_id
             AND active.branch_id = ctot.branch_id
             AND active.planning_date = ctot.date
             AND active.revoked_at IS NULL
             AND (
               active.exclusion_scope = 'all_teams'
               OR (
                 active.exclusion_scope = 'team'
                 AND active.team_key = ctot.team_key
               )
             )
        )`,
    [
      taskIds,
      payload.branchId,
      payload.date,
      payload.layer === 'ALL_TEAMS_DAY',
      payload.teamKey,
    ],
  );
  return Number(rowCount ?? 0);
}

export async function lockClientContactControlMutations(
  db: Queryable,
  clientIds: number[],
) {
  for (const clientId of uniquePositiveIntegers(clientIds)) {
    await db.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`client-contact-control:${clientId}`],
    );
  }
}

export async function applyClientDoNotContactState(
  db: Queryable,
  params: {
    clientIds: number[];
    enable: boolean;
    reasonCode: string;
    reasonText: string | null;
    operationId?: number | null;
    userId: number;
  },
) {
  const clientIds = uniquePositiveIntegers(params.clientIds);
  if (clientIds.length === 0) {
    return { changedClients: 0, releasedAssignments: 0, closedTargets: 0 };
  }
  await lockClientContactControlMutations(db, clientIds);
  const { rows: clients } = await db.query(
    `SELECT id, branch_id AS "branchId", do_not_contact AS "doNotContact"
       FROM clients
      WHERE id = ANY($1::int[])
      ORDER BY id
      FOR UPDATE`,
    [clientIds],
  );
  if (clients.length !== clientIds.length) {
    throw new PlanningCurationError(
      'تغيرت مجموعة الزبائن قبل التطبيق',
      409,
      'PREVIEW_STALE',
    );
  }

  const changedIds = clients
    .filter(row => row.doNotContact !== params.enable)
    .map(row => Number(row.id));
  if (changedIds.length > 0) {
    await db.query(
      `UPDATE clients
          SET do_not_contact = $1
        WHERE id = ANY($2::int[])`,
      [params.enable, changedIds],
    );
    await db.query(
      `INSERT INTO client_contact_control_events (
         client_id, branch_id, control_type, action, reason_code, reason_text,
         operation_id, performed_by
       )
       SELECT
         c.id,
         c.branch_id,
         'do_not_contact',
         $2,
         $3,
         $4,
         $5,
         $6
       FROM clients c
       WHERE c.id = ANY($1::int[])`,
      [
        changedIds,
        params.enable ? 'enabled' : 'disabled',
        params.reasonCode,
        params.reasonText,
        params.operationId ?? null,
        params.userId,
      ],
    );
  }

  let releasedRows: any[] = [];
  let closedTargets = 0;
  if (params.enable) {
    const result = await db.query(
      `SELECT
         ot.id,
         ot.status AS "oldStatus",
         ot.last_waiting_status AS "lastWaitingStatus"
       FROM open_tasks ot
       WHERE ot.client_id = ANY($1::int[])
         AND ot.status = 'assigned'
       ORDER BY ot.id
       FOR UPDATE OF ot`,
      [clientIds],
    );
    releasedRows = result.rows;
    if (releasedRows.length > 0) {
      await db.query(
        `UPDATE open_tasks
            SET status = COALESCE(last_waiting_status, 'open'),
                assigned_scope_id = NULL,
                assigned_team_key = NULL,
                assigned_for_date = NULL,
                assigned_at = NULL,
                updated_at = NOW()
          WHERE id = ANY($1::int[])
            AND status = 'assigned'`,
        [releasedRows.map(row => Number(row.id))],
      );
      await recordAssignmentReleaseEvents(
        db,
        releasedRows,
        params.userId,
        params.reasonText,
      );
    }

    const closed = await db.query(
      `UPDATE contact_targets
          SET status = 'closed',
              closing_reason = 'do_not_contact',
              closed_by = $2,
              closed_at = COALESCE(closed_at, NOW()),
              updated_at = NOW()
        WHERE target_type = 'client'
          AND target_id = ANY($1::int[])
          AND status IN ('new', 'queued', 'in_call_list', 'contacted')
        RETURNING id`,
      [clientIds, params.userId],
    );
    closedTargets = Number(closed.rowCount ?? 0);

    await db.query(
      `UPDATE contact_target_open_tasks ctot
          SET link_status = 'closed',
              updated_at = NOW()
         FROM contact_targets ct
        WHERE ctot.contact_target_id = ct.id
          AND ct.target_type = 'client'
          AND ct.target_id = ANY($1::int[])
          AND ct.status = 'closed'
          AND ct.closing_reason = 'do_not_contact'
          AND ctot.link_status <> 'closed'`,
      [clientIds],
    );
  }
  return {
    changedClients: changedIds.length,
    releasedAssignments: releasedRows.length,
    closedTargets,
  };
}

async function applyClientContactControl(
  db: Queryable,
  payload: CurationPreviewTokenPayload,
  operationId: number,
  clientIds: number[],
) {
  return applyClientDoNotContactState(db, {
    clientIds,
    enable: payload.action === 'SET_DO_NOT_CONTACT',
    reasonCode: payload.reasonCode,
    reasonText: payload.reasonText,
    operationId,
    userId: payload.userId,
  });
}

export async function applyPlanningCuration(params: {
  authContext: AuthContext;
  previewToken: string;
}) {
  let payload: CurationPreviewTokenPayload;
  try {
    payload = jwt.verify(params.previewToken, JWT_SECRET, {
      audience: CURATION_TOKEN_AUDIENCE,
      issuer: CURATION_TOKEN_ISSUER,
    }) as CurationPreviewTokenPayload;
  } catch {
    throw new PlanningCurationError(
      'انتهت صلاحية المعاينة؛ أعد المعاينة قبل التطبيق',
      409,
      'PREVIEW_EXPIRED',
    );
  }
  if (payload.type !== 'planning_curation_preview' || payload.userId !== params.authContext.userId) {
    throw new PlanningCurationError(
      'المعاينة لا تخص هذا المستخدم',
      403,
      'PREVIEW_OWNER_MISMATCH',
    );
  }

  validateContext(payload.date, payload.teamKey, payload.branchId);
  validateActionLayer(payload.action, payload.layer);
  await assertPlanningSubject(
    params.authContext,
    payload.date,
    payload.teamKey,
    payload.branchId,
  );
  const selector = normalizePlanningCurationSelector(payload.selector);
  const beforeTransaction = await resolveSelection({
    authContext: params.authContext,
    date: payload.date,
    teamKey: payload.teamKey,
    branchId: payload.branchId,
    selector,
    action: payload.action,
    layer: payload.layer,
  });
  if (beforeTransaction.selectionFingerprint !== payload.selectionFingerprint) {
    throw new PlanningCurationError(
      'تغيرت حالة المهام منذ المعاينة',
      409,
      'PREVIEW_STALE',
    );
  }
  if (payload.layer === 'CLIENT_DO_NOT_CONTACT') {
    await assertClientContactControlScope(
      params.authContext,
      beforeTransaction.contacts.map(contact => contact.clientId),
    );
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await acquirePlanningMutationLock(db, payload.branchId, payload.date);
    await assertPlanningSubject(
      params.authContext,
      payload.date,
      payload.teamKey,
      payload.branchId,
      db,
    );

    const selection = await resolveSelection({
      authContext: params.authContext,
      date: payload.date,
      teamKey: payload.teamKey,
      branchId: payload.branchId,
      selector,
      action: payload.action,
      layer: payload.layer,
      db,
    });
    if (
      selection.selectionFingerprint !== payload.selectionFingerprint
      || selection.built.queryFingerprint !== payload.queryFingerprint
    ) {
      throw new PlanningCurationError(
        'تغيرت نتائج المعاينة قبل التطبيق',
        409,
        'PREVIEW_STALE',
      );
    }

    const taskIds = selection.tasks.map(task => task.taskId);
    const selectedClientIds = uniquePositiveIntegers(
      selection.contacts.map(contact => contact.clientId),
    );
    if (payload.layer === 'CLIENT_DO_NOT_CONTACT') {
      await lockClientContactControlMutations(
        db,
        selectedClientIds,
      );
    }
    // Every planning mutation follows the same client -> task row-lock order.
    // This matches profile contact-control writes and prevents task/client
    // deadlocks when a dashboard action races a permanent contact decision.
    await lockSelectedClientRows(db, selectedClientIds);
    if (payload.layer === 'CLIENT_DO_NOT_CONTACT') {
      await assertClientContactControlScope(
        params.authContext,
        selectedClientIds,
        db,
      );
    }
    const lockedRows = await loadLockedSelectionState(
      db,
      taskIds,
      payload.branchId,
      payload.date,
      payload.teamKey,
    );
    if (
      lockedRows.length !== taskIds.length
      || lockedSelectionFingerprint(lockedRows, payload.date) !== payload.selectionFingerprint
    ) {
      throw new PlanningCurationError(
        'تغير إسناد أو استبعاد إحدى المهام قبل التطبيق',
        409,
        'PREVIEW_STALE',
      );
    }
    if (
      payload.layer !== 'CLIENT_DO_NOT_CONTACT'
      && lockedRows.some(row =>
        !EXCLUDABLE_STATES.has(row.status) || row.taskCommitted === true)
    ) {
      throw new PlanningCurationError(
        'تتضمن الدفعة مهمة معتمدة قيد الجدولة أو ما بعدها',
        409,
        'TASK_COMMITTED',
      );
    }

    const contactImpact = payload.layer === 'CLIENT_DO_NOT_CONTACT'
      ? await loadClientContactControlImpact(
          db,
          selection.contacts.map(contact => contact.clientId),
        )
      : null;
    const operationId = await insertCurationOperation(
      db,
      payload,
      selection,
      contactImpact?.affectedTasks ?? selection.tasks.length,
    );
    let changedTasks = 0;
    let changedClients = 0;
    let releasedAssignments = 0;
    if (payload.action === 'EXCLUDE') {
      changedTasks = lockedRows.filter(row =>
        payload.layer === 'TEAM_DAY'
          ? row.currentTeamDayExcluded !== true
          : row.allTeamsDayExcluded !== true,
      ).length;
      releasedAssignments = await applyTaskExclusion(
        db,
        payload,
        operationId,
        lockedRows,
      );
    } else if (payload.action === 'RESTORE') {
      changedTasks = await applyTaskRestore(
        db,
        payload,
        operationId,
        lockedRows,
      );
    } else {
      const contactResult = await applyClientContactControl(
        db,
        payload,
        operationId,
        selection.contacts.map(contact => contact.clientId),
      );
      changedClients = contactResult.changedClients;
      releasedAssignments = contactResult.releasedAssignments;
    }

    await db.query('COMMIT');
    return {
      operationId,
      date: payload.date,
      teamKey: payload.teamKey,
      action: payload.action,
      layer: payload.layer,
      changedTasks,
      changedClients,
      releasedAssignments,
      refreshRequired: true,
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export async function lockPlanningDayMutation(
  db: Queryable,
  branchId: number,
  date: string,
) {
  await acquirePlanningMutationLock(db, branchId, date);
}
