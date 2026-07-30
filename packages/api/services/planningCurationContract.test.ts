import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildPlanningContactContextAvailablePredicate,
  buildPlanningTaskAvailablePredicate,
  buildPlanningTaskExcludedPredicate,
} from './planningContactTargetScope.js';
import {
  applyClientDoNotContactState,
  filterPlanningCurationTasksForAction,
  normalizePlanningCurationSelector,
  normalizePlanningDashboardFilters,
  PlanningCurationError,
  type PlanningContactTask,
} from './planningTaskCuration.js';

const exclusionMigration = readFileSync(
  new URL('../../../migrations/398_planning_task_exclusion_scopes.sql', import.meta.url),
  'utf8',
);
const contactControlMigration = readFileSync(
  new URL('../../../migrations/399_client_contact_control_audit.sql', import.meta.url),
  'utf8',
);
const assignedTasksSource = readFileSync(new URL('./assignedTasks.ts', import.meta.url), 'utf8');
const planningTaskCurationSource = readFileSync(
  new URL('./planningTaskCuration.ts', import.meta.url),
  'utf8',
);
const planningMarketingTargetsSource = readFileSync(
  new URL('./planningMarketingTargets.ts', import.meta.url),
  'utf8',
);
const telemarketingRouteSource = readFileSync(
  new URL('../routes/telemarketing.ts', import.meta.url),
  'utf8',
);
const routeAssignmentsSource = readFileSync(
  new URL('../routes/routeAssignments.ts', import.meta.url),
  'utf8',
);

test('planning exclusion predicate combines legacy, all-team, and current-team layers for D', () => {
  const predicate = buildPlanningTaskExcludedPredicate('ot', '$3', '$4');

  assert.match(predicate, /ot\.excluded_for_date = \$4::date/);
  assert.match(predicate, /planning_exclusion\.open_task_id = ot\.id/);
  assert.match(predicate, /planning_exclusion\.branch_id = ot\.branch_id/);
  assert.match(predicate, /planning_exclusion\.planning_date = \$4::date/);
  assert.match(predicate, /planning_exclusion\.revoked_at IS NULL/);
  assert.match(predicate, /planning_exclusion\.exclusion_scope = 'all_teams'/);
  assert.match(predicate, /planning_exclusion\.exclusion_scope = 'team'/);
  assert.match(predicate, /planning_exclusion\.team_key = \$3/);

  const available = buildPlanningTaskAvailablePredicate('ot', '$3', '$4');
  assert.equal(available, `NOT ${predicate}`);
});

test('contact-grain predicate prevents another team owning a sibling task or target', () => {
  const predicate = buildPlanningContactContextAvailablePredicate(
    'ot',
    'ttc',
    'installed',
    '$3',
    '$4',
  );

  assert.match(predicate, /context_task\.branch_id = ot\.branch_id/);
  assert.match(predicate, /context_task\.client_id = ot\.client_id/);
  assert.match(predicate, /context_task\.assigned_for_date = \$4::date/);
  assert.match(predicate, /context_task\.assigned_team_key <> \$3/);
  assert.match(predicate, /context_task\.status IN \([\s\S]*'assigned'[\s\S]*'in_scheduling'/);
  assert.match(predicate, /context_target\.target_id = ot\.client_id/);
  assert.match(predicate, /context_target\.date = \$4::date/);
  assert.match(predicate, /context_target\.team_key <> \$3/);
  assert.match(predicate, /context_target\.work_location_geo_unit_id[\s\S]*IS NOT DISTINCT FROM/);
  assert.match(predicate, /ttc\.location_basis IN \('contract', 'device'\)/);
  assert.match(predicate, /installed\.installation_geo_unit_id/);
});

test('all planning SQL builders reject unsafe identifiers and parameters', () => {
  assert.throws(
    () => buildPlanningTaskExcludedPredicate('ot; DROP TABLE open_tasks', '$1', '$2'),
    /Invalid task alias/,
  );
  assert.throws(
    () => buildPlanningTaskAvailablePredicate('ot', '$1 OR TRUE', '$2'),
    /Invalid team parameter/,
  );
  assert.throws(
    () => buildPlanningContactContextAvailablePredicate('ot', 'ttc', 'idv JOIN x', '$1', '$2'),
    /Invalid installed device alias/,
  );
  assert.throws(
    () => buildPlanningContactContextAvailablePredicate('ot', 'ttc', 'idv', '$1', 'CURRENT_DATE'),
    /Invalid date parameter/,
  );
});

test('dashboard filters normalize identifiers, enums, ranges, and ordering deterministically', () => {
  const normalized = normalizePlanningDashboardFilters({
    q: '  أحمد  ',
    lifecycleStatuses: ['closed', 'ready', 'closed', 'invalid' as never],
    stationIds: [9, 2, 9, -1, 0],
    classifications: ['vip', 'regular', 'vip'],
    ownershipTypes: ['company', 'personal', 'company'],
    minTaskCount: -50,
    maxTaskCount: 500_000,
    taskIds: [22, 3, 22, -9],
    taskTypes: ['device_demo', 'collection', 'device_demo'],
    taskFamilies: ['service', 'marketing', 'service'],
    taskStatuses: ['open', 'assigned', 'open'],
    priorities: ['high', 'low', 'high'],
    dueState: 'ON_DATE',
    attemptsMin: 1_500_000,
    phoneState: 'VALID',
    exclusionLayers: [
      'CLIENT_DO_NOT_CONTACT',
      'TEAM_DAY',
      'TEAM_DAY',
      'unsupported' as never,
    ],
  });

  assert.deepEqual(normalized, {
    q: 'أحمد',
    lifecycleStatuses: ['closed', 'ready'],
    stationIds: [2, 9],
    classifications: ['regular', 'vip'],
    ownershipTypes: ['company', 'personal'],
    minTaskCount: 0,
    maxTaskCount: 100_000,
    taskIds: [3, 22],
    taskTypes: ['collection', 'device_demo'],
    taskFamilies: ['marketing', 'service'],
    taskStatuses: ['assigned', 'open'],
    priorities: ['high', 'low'],
    dueState: 'ON_DATE',
    attemptsMin: 1_000_000,
    phoneState: 'VALID',
    exclusionLayers: ['CLIENT_DO_NOT_CONTACT', 'TEAM_DAY'],
  });
});

test('explicit task and contact selectors normalize deterministically without silent widening', () => {
  assert.deepEqual(
    normalizePlanningCurationSelector({
      kind: 'TASK_IDS',
      taskIds: [20, 3, 20, 0, -4],
    }),
    {
      kind: 'TASK_IDS',
      taskIds: [3, 20],
    },
  );
  assert.deepEqual(
    normalizePlanningCurationSelector({
      kind: 'CONTACT_KEYS',
      contactKeys: [' row-b ', 'row-a', 'row-b', ''],
    }),
    {
      kind: 'CONTACT_KEYS',
      contactKeys: ['row-a', 'row-b'],
    },
  );

  assert.throws(
    () => normalizePlanningCurationSelector({ kind: 'TASK_IDS', taskIds: [] }),
    (error: unknown) =>
      error instanceof PlanningCurationError
      && error.status === 400
      && error.code === 'INVALID_TASK_SELECTOR',
  );
  assert.throws(
    () => normalizePlanningCurationSelector({
      kind: 'CONTACT_KEYS',
      contactKeys: Array.from({ length: 1_001 }, (_, index) => `row-${index}`),
    }),
    (error: unknown) =>
      error instanceof PlanningCurationError
      && error.status === 400
      && error.code === 'INVALID_CONTACT_SELECTOR',
  );
});

test('filtered selector binds normalized filters, target mode, fingerprint, and exceptions', () => {
  const fingerprint = 'a'.repeat(64);
  assert.deepEqual(
    normalizePlanningCurationSelector({
      kind: 'FILTERED_SET',
      filters: {
        q: '  زبون  ',
        stationIds: [8, 2, 8],
        taskIds: [90, 4, 90],
      },
      queryFingerprint: fingerprint,
      targetMode: 'NON_MATCHING_TASKS_OF_MATCHED_CONTACTS',
      exceptTaskIds: [11, 5, 11],
      exceptContactKeys: [' row-z ', 'row-a', 'row-z'],
    }),
    {
      kind: 'FILTERED_SET',
      filters: {
        q: 'زبون',
        stationIds: [2, 8],
        taskIds: [4, 90],
      },
      queryFingerprint: fingerprint,
      targetMode: 'NON_MATCHING_TASKS_OF_MATCHED_CONTACTS',
      exceptTaskIds: [5, 11],
      exceptContactKeys: ['row-a', 'row-z'],
    },
  );

  assert.throws(
    () => normalizePlanningCurationSelector({
      kind: 'FILTERED_SET',
      filters: {},
      queryFingerprint: fingerprint,
      targetMode: 'INVALID' as never,
    }),
    (error: unknown) =>
      error instanceof PlanningCurationError
      && error.code === 'INVALID_TARGET_MODE',
  );
  assert.throws(
    () => normalizePlanningCurationSelector({
      kind: 'FILTERED_SET',
      filters: {},
      queryFingerprint: 'z'.repeat(64),
      targetMode: 'MATCHING_TASKS',
    }),
    (error: unknown) =>
      error instanceof PlanningCurationError
      && error.code === 'QUERY_FINGERPRINT_REQUIRED',
  );
});

test('migration constrains action-layer pairs and immutable exclusion history', () => {
  assert.match(exclusionMigration, /planning_curation_operations_action_layer_check/);
  assert.match(
    exclusionMigration,
    /action IN \('exclude', 'restore'\)[\s\S]*layer IN \('team_day', 'all_teams_day'\)/,
  );
  assert.match(
    exclusionMigration,
    /action IN \('set_do_not_contact', 'clear_do_not_contact'\)[\s\S]*layer = 'client_do_not_contact'/,
  );
  assert.match(
    exclusionMigration,
    /FOREIGN KEY \(open_task_id, branch_id\)[\s\S]*REFERENCES public\.open_tasks\(id, branch_id\) ON DELETE RESTRICT/,
  );
  assert.match(
    exclusionMigration,
    /exclusion_scope = 'team' AND team_key IS NOT NULL AND team_snapshot IS NOT NULL/,
  );
  assert.match(
    exclusionMigration,
    /exclusion_scope = 'all_teams' AND team_key IS NULL AND team_snapshot IS NULL/,
  );
  assert.match(
    exclusionMigration,
    /planning_task_exclusions_active_all_teams_uidx[\s\S]*WHERE exclusion_scope = 'all_teams' AND revoked_at IS NULL/,
  );
  assert.match(
    exclusionMigration,
    /planning_task_exclusions_active_team_uidx[\s\S]*WHERE exclusion_scope = 'team' AND revoked_at IS NULL/,
  );
  assert.match(exclusionMigration, /revoked_operation_id BIGINT[\s\S]*ON DELETE RESTRICT/);
});

test('legacy backfill preserves every dated value as all-teams only', () => {
  const backfill = exclusionMigration.slice(
    exclusionMigration.indexOf('INSERT INTO public.planning_task_exclusions'),
  );

  assert.match(backfill, /ot\.excluded_for_date/);
  assert.match(backfill, /'all_teams'/);
  assert.match(backfill, /'legacy_day_exclusion'/);
  assert.match(backfill, /WHERE ot\.excluded_for_date IS NOT NULL/);
  assert.doesNotMatch(backfill, /CURRENT_DATE/);
  assert.doesNotMatch(backfill, /'team_[^']*'/);
});

test('do-not-contact keeps a customer-wide live flag plus append-only audit events', () => {
  assert.match(contactControlMigration, /CREATE TABLE IF NOT EXISTS public\.client_contact_control_events/);
  assert.match(contactControlMigration, /REFERENCES public\.clients\(id\) ON DELETE RESTRICT/);
  assert.match(contactControlMigration, /control_type IN \('do_not_contact'\)/);
  assert.match(contactControlMigration, /action IN \('enabled', 'disabled'\)/);
  assert.match(contactControlMigration, /operation_id BIGINT[\s\S]*ON DELETE RESTRICT/);
  assert.match(contactControlMigration, /Append-only audit of permanent customer-wide contact controls/);
  assert.match(
    contactControlMigration,
    /reason_code[\s\S]*'legacy_state_baseline'[\s\S]*c\.do_not_contact IS TRUE[\s\S]*NOT EXISTS/,
  );
});

test('assignment reconciliation locks D and guards retained-team refresh and release writes', () => {
  assert.match(
    assignedTasksSource,
    /await lockPlanningDayMutation\(db, branchId, date\)/,
  );
  assert.match(
    assignedTasksSource,
    /SET assigned_scope_id = \$1[\s\S]*assigned_team_key = \$3[\s\S]*assigned_for_date = \$4[\s\S]*branch_id = \$5/,
  );
  assert.match(
    assignedTasksSource,
    /SET status\s+= COALESCE\(last_waiting_status, 'open'\)[\s\S]*assigned_team_key = \$2[\s\S]*assigned_for_date = \$3[\s\S]*branch_id = \$4/,
  );
  assert.ok(
    (assignedTasksSource.match(/buildPlanningTaskAvailablePredicate\('open_tasks'/g) ?? []).length >= 2,
    'eligibility read and assignment write must both enforce layered exclusions',
  );
});

test('route assignment save locks D and atomically commits UPSERT plus assignment sync', () => {
  const routeStart = routeAssignmentsSource.indexOf(
    "router.put('/:key', requirePermission('routes.assign.manage')",
  );
  const routeEnd = routeAssignmentsSource.indexOf('export default router', routeStart);
  const saveRoute = routeAssignmentsSource.slice(routeStart, routeEnd);

  const beginAt = saveRoute.indexOf("pgClient.query('BEGIN')");
  const lockAt = saveRoute.indexOf(
    'await lockPlanningDayMutation(pgClient, syncBranchId, date)',
  );
  const teamRecheckAt = saveRoute.indexOf(
    'resolveAssignmentOwningBranch(date, teamKey, pgClient)',
  );
  const freezeRecheckAt = saveRoute.indexOf('FROM telemarketing_task_lists');
  const upsertAt = saveRoute.indexOf('INSERT INTO route_assignments');
  const syncAt = saveRoute.indexOf('const syncResult = await syncAssignedTasks({');
  const commitAt = saveRoute.indexOf("pgClient.query('COMMIT')");

  assert.ok(routeStart >= 0, 'PUT route-assignment handler must exist');
  assert.ok(
    beginAt >= 0
      && beginAt < lockAt
      && lockAt < teamRecheckAt
      && teamRecheckAt < freezeRecheckAt
      && freezeRecheckAt < upsertAt
      && upsertAt < syncAt
      && syncAt < commitAt,
    'save must lock D, recheck the team/freeze, UPSERT, sync, then commit in order',
  );
  assert.match(
    saveRoute.slice(syncAt, commitAt),
    /db: pgClient/,
    'sync must use the same transaction client as the UPSERT',
  );
  assert.match(
    saveRoute,
    /catch \(err\) \{[\s\S]*await pgClient\.query\('ROLLBACK'\);[\s\S]*throw err;/,
  );
  assert.doesNotMatch(
    saveRoute,
    /syncWarning/,
    'atomic save must not expose a partial-success warning contract',
  );
});

test('generation shares the planning-day lock and claims a task before inserting its list item', () => {
  const routeStart = telemarketingRouteSource.indexOf(
    "router.post('/task-lists/generate-from-plan'",
  );
  const routeEnd = telemarketingRouteSource.indexOf(
    "router.patch(\n  '/task-lists/:taskListId/items/:itemId'",
    routeStart,
  );
  const generation = telemarketingRouteSource.slice(routeStart, routeEnd);

  const lockAt = generation.indexOf('await lockPlanningDayMutation(pgClient, branchId, date)');
  const readAt = generation.indexOf('await getAssignedLeadsForTeam({');
  const claimAt = generation.indexOf('UPDATE open_tasks ot');
  const insertAt = generation.indexOf('INSERT INTO telemarketing_task_list_items');
  assert.ok(lockAt >= 0 && lockAt < readAt, 'planning lock must precede the assigned-task read');
  assert.ok(claimAt > readAt && claimAt < insertAt, 'guarded task claim must precede list-item insert');
  assert.match(generation, /ot\.status = 'assigned'/);
  assert.match(generation, /ot\.assigned_team_key = \$3/);
  assert.match(generation, /ot\.assigned_for_date = \$4::date/);
  assert.match(generation, /buildPlanningTaskAvailablePredicate\('ot', '\$3', '\$4'\)/);
});

test('cooldown remains active through D in preview, eligibility, generation, and calls', () => {
  assert.match(
    planningTaskCurationSource,
    /function isCooldownActive[\s\S]*until\.slice\(0, 10\) >= date/,
  );
  assert.match(
    planningMarketingTargetsSource,
    /c\.cooldown_until IS NULL OR c\.cooldown_until < \$4::date/,
  );
  assert.match(
    telemarketingRouteSource,
    /c\.cooldown_until IS NULL OR c\.cooldown_until < \$4::date/,
  );
  assert.match(
    telemarketingRouteSource,
    /c\.cooldown_until >= task_list\.date::date/,
  );
});

test('closed contact targets and client contact controls block every execution entry point', () => {
  assert.match(
    telemarketingRouteSource,
    /code: 'CLIENT_DO_NOT_CONTACT'[\s\S]*code: 'CLIENT_CONTACT_COOLDOWN'[\s\S]*code: 'CONTACT_TARGET_CLOSED'/,
  );
  assert.equal(
    (telemarketingRouteSource.match(/rejectBlockedContactExecution\(/g) ?? []).length,
    5,
    'the shared guard must be defined once and called by item patch, claim, call-log, and book-visit',
  );

  const bookingStart = telemarketingRouteSource.indexOf(
    "router.post('/book-visit'",
  );
  const bookingEnd = telemarketingRouteSource.indexOf(
    "router.post('/appointments'",
    bookingStart,
  );
  const bookingSource = telemarketingRouteSource.slice(bookingStart, bookingEnd);
  const guardAt = bookingSource.indexOf('acquireClientContactControlReadGuard(clientId)');
  const stateAt = bookingSource.indexOf('rejectBlockedContactExecution(res, executionState)');
  const claimAt = bookingSource.indexOf('claimContactTarget(pool, contactTargetId');
  const bookAt = bookingSource.indexOf('const result = await bookVisit({');
  assert.ok(
    guardAt >= 0
      && guardAt < stateAt
      && stateAt < claimAt
      && claimAt < bookAt,
    'book-visit must hold the client guard and reject a blocked/closed subject before claim or booking',
  );
});

test('planning apply locks selected clients before selected tasks', () => {
  const applyStart = planningTaskCurationSource.indexOf(
    'export async function applyPlanningCuration',
  );
  const applySource = planningTaskCurationSource.slice(applyStart);
  const clientLockAt = applySource.indexOf('await lockSelectedClientRows(db, selectedClientIds)');
  const taskLockAt = applySource.indexOf('const lockedRows = await loadLockedSelectionState(');
  assert.ok(
    clientLockAt >= 0 && clientLockAt < taskLockAt,
    'planning mutations must follow the client -> task row-lock order',
  );
  assert.match(
    planningTaskCurationSource,
    /ORDER BY ot\.id\s+FOR UPDATE OF ot`/,
  );
  assert.doesNotMatch(
    planningTaskCurationSource,
    /ORDER BY ot\.id\s+FOR UPDATE OF ot, c`/,
  );
});

test('FILTERED_SET task actions select actionable delta and count frozen tasks as skipped', () => {
  const resolveStart = planningTaskCurationSource.indexOf('async function resolveSelection');
  const resolveEnd = planningTaskCurationSource.indexOf(
    'type CurationPreviewTokenPayload',
    resolveStart,
  );
  const resolveSource = planningTaskCurationSource.slice(resolveStart, resolveEnd);
  const makeTaskStart = planningTaskCurationSource.indexOf('function makeTask');
  const makeTaskEnd = planningTaskCurationSource.indexOf(
    'async function loadContactTargetMeta',
    makeTaskStart,
  );
  const makeTaskSource = planningTaskCurationSource.slice(makeTaskStart, makeTaskEnd);

  assert.match(makeTaskSource, /const committed = task\.committedArtifact \|\| COMMITTED_STATES\.has\(task\.status\)/);
  assert.match(makeTaskSource, /if \(!committed\) \{[\s\S]*availableActions\.push\('EXCLUDE_TEAM_DAY'\)/);
  assert.match(
    resolveSource,
    /selector\.kind === 'FILTERED_SET'[\s\S]*filterPlanningCurationTasksForAction\([\s\S]*selectedByMode/,
  );
  assert.match(
    planningTaskCurationSource,
    /skippedUnavailableTasks: selection\.skippedUnavailableTasks/,
  );

  const deltaTeam = {
    taskId: 1,
    availableActions: ['EXCLUDE_TEAM_DAY'],
  } as PlanningContactTask;
  const deltaAllTeams = {
    taskId: 2,
    availableActions: ['EXCLUDE_ALL_TEAMS_DAY', 'RESTORE_TEAM_DAY'],
  } as PlanningContactTask;
  const committed = {
    taskId: 3,
    assignment: { teamKey: 'team_0', date: '2026-07-31', committed: true },
    availableActions: [],
  } as PlanningContactTask;
  const selected = [deltaTeam, deltaAllTeams, committed];

  assert.deepEqual(
    filterPlanningCurationTasksForAction(selected, 'EXCLUDE', 'TEAM_DAY'),
    {
      tasks: [deltaTeam],
      skippedUnavailableTasks: 2,
    },
  );
  assert.deepEqual(
    filterPlanningCurationTasksForAction(selected, 'RESTORE', 'TEAM_DAY'),
    {
      tasks: [deltaAllTeams],
      skippedUnavailableTasks: 2,
    },
  );
  assert.deepEqual(
    filterPlanningCurationTasksForAction(selected, 'SET_DO_NOT_CONTACT', 'CLIENT_DO_NOT_CONTACT'),
    {
      tasks: selected,
      skippedUnavailableTasks: 0,
    },
    'DNC must retain the contact selection even when its tasks are committed',
  );
});

test('CONTACT_KEYS DNC resolves to unique clients instead of treating task ids as the control subject', () => {
  const resolveStart = planningTaskCurationSource.indexOf('async function resolveSelection');
  const resolveEnd = planningTaskCurationSource.indexOf(
    'type CurationPreviewTokenPayload',
    resolveStart,
  );
  const resolveSource = planningTaskCurationSource.slice(resolveStart, resolveEnd);

  assert.match(
    resolveSource,
    /selector\.kind === 'CONTACT_KEYS'[\s\S]*rows = built\.allRows\.filter\(row => wanted\.has\(row\.rowKey\)\)/,
  );
  assert.match(resolveSource, /tasks = rows\.flatMap\(row => row\.tasks\)/);
  assert.match(resolveSource, /const tasksByClient = new Map<number, string\[\]>\(\)/);
  assert.match(resolveSource, /tasksByClient\.has\(row\.clientId\)/);
  assert.match(resolveSource, /const contacts = \[\.\.\.tasksByClient\.entries\(\)\]/);
  assert.match(
    planningTaskCurationSource,
    /payload\.layer === 'CLIENT_DO_NOT_CONTACT'[\s\S]*selection\.contacts\.map\(contact => contact\.clientId\)/,
  );
});

test('DNC releases assigned tasks only and never rewinds in_scheduling', async () => {
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (/FROM clients[\s\S]*FOR UPDATE/.test(sql)) {
        return { rows: [{ id: 41, branchId: 7, doNotContact: false }], rowCount: 1 };
      }
      if (/FROM open_tasks ot[\s\S]*FOR UPDATE OF ot/.test(sql)) {
        return {
          rows: [{ id: 501, oldStatus: 'assigned', lastWaitingStatus: 'needs_follow_up' }],
          rowCount: 1,
        };
      }
      if (/UPDATE contact_targets/.test(sql)) {
        return { rows: [{ id: 80 }, { id: 81 }], rowCount: 2 };
      }
      return { rows: [], rowCount: 1 };
    },
  };

  const result = await applyClientDoNotContactState(db as never, {
    clientIds: [41],
    enable: true,
    reasonCode: 'requested',
    reasonText: 'طلب الزبون عدم التواصل',
    userId: 9,
  });

  assert.deepEqual(result, {
    changedClients: 1,
    releasedAssignments: 1,
    closedTargets: 2,
  });
  const releaseWrite = queries.find(({ sql }) =>
    /UPDATE open_tasks[\s\S]*SET status = COALESCE\(last_waiting_status, 'open'\)/.test(sql),
  );
  assert.ok(releaseWrite, 'DNC must release the still-uncommitted assigned task');
  assert.match(releaseWrite.sql, /AND status = 'assigned'/);
  assert.doesNotMatch(releaseWrite.sql, /in_scheduling/);
  assert.equal(
    queries.some(({ sql }) => /UPDATE open_tasks[\s\S]*in_scheduling/.test(sql)),
    false,
    'DNC must not rewrite an in_scheduling task to waiting',
  );
});
