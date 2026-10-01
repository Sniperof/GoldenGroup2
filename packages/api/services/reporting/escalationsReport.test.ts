import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildEscalationsQuery, VISIT_ESCALATION_TYPES } from './escalationsReport.js';
import { findTabularReport } from './tabularReportCatalog.js';
import { TABULAR_REQUEST_PARAM_KEYS, type TabularReportAccess } from './tabularReportAccess.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 42 };
const BRANCH_ACCESS = { scope: 'BRANCH' as const, grantedScope: 'BRANCH' as const, branchIds: [3, 7], userId: 42 };
const ASSIGNED_ACCESS = { scope: 'ASSIGNED' as const, grantedScope: 'ASSIGNED' as const, branchIds: [3], userId: 42 };
const RANGE = { fromDate: '2026-08-01', toDate: '2026-08-31' };

const build = (request: Record<string, unknown> = RANGE, access: TabularReportAccess = GLOBAL_ACCESS) =>
  buildEscalationsQuery(access, request, { limit: 100 });
const query = (request: Record<string, unknown> = RANGE, access: TabularReportAccess = GLOBAL_ACCESS) =>
  build(request, access).sql;
const between = (sql: string, from: string, to: string) => {
  const start = sql.indexOf(from);
  return sql.slice(start, sql.indexOf(to, start + from.length));
};

test('three sources, each reduced to one row per case before the union', () => {
  const sql = query();
  assert.match(sql, /cases AS \(\s*\n\s*SELECT \* FROM sr_cases\s*\n\s*UNION ALL SELECT \* FROM visit_undocumented\s*\n\s*UNION ALL SELECT \* FROM visit_not_started/);
  // Job applications are out of the report (DEC-ESC-2).
  assert.doesNotMatch(sql, /job_applications|audit_logs\b/);
});

test('a request case is an escalation event in the protected log, not the request row (DEC-ESC-1/3)', () => {
  const sql = query();
  const escalations = between(sql, 'sr_escalations AS (', 'sr_cases AS (');
  assert.match(escalations, /FROM service_request_audit_log log/);
  assert.match(escalations, /log\.event_type = 'escalated_to_audit_admin'/);
  // The row's own escalation columns are cleared on resolve, so they are never read.
  assert.doesNotMatch(sql, /request\.escalated_at|request\.escalation_reason/);
  assert.match(sql, /escalation\.escalation_log_id::bigint AS source_id/);
});

test('the case ends at the FIRST exit after it, in log order', () => {
  const sql = query();
  const exit = between(sql, 'LEFT JOIN LATERAL (', ') exit_event ON TRUE');
  assert.match(exit, /\(exit_log\.created_at, exit_log\.id\) > \(escalation\.escalated_at, escalation\.escalation_log_id\)/);
  assert.match(exit, /exit_log\.event_type IN \('escalation_resolved', 'rejected_decision', 'escalated_to_audit_admin'\)/);
  assert.match(exit, /exit_log\.event_payload->>'to' IN \('rejected', 'cancelled', 'promoted', 'resolved_at_intake'\)/);
  assert.match(exit, /ORDER BY exit_log\.created_at ASC, exit_log\.id ASC\s*\n\s*LIMIT 1/);
});

test('each exit maps to its state, and a second escalation closes the first without a resolution', () => {
  const sql = query();
  assert.match(sql, /WHEN exit_event\.event_type IS NULL THEN 'open'/);
  assert.match(sql, /WHEN exit_event\.event_type = 'escalation_resolved' THEN 'resolved'/);
  assert.match(sql, /WHEN exit_event\.event_type = 'rejected_decision'\s*\n\s*OR exit_event\.to_status = 'rejected' THEN 'rejected'/);
  assert.match(sql, /WHEN exit_event\.event_type = 'escalated_to_audit_admin' THEN 'superseded'/);
  assert.match(sql, /CASE WHEN exit_event\.event_type = 'escalated_to_audit_admin' THEN NULL\s*\n\s*ELSE exit_event\.created_at END AS resolved_at/);
});

test('an undocumented visit is one case at its deepest tier (DEC-ESC-5)', () => {
  const sql = query();
  const visits = between(sql, 'visit_undocumented AS (', 'visit_not_started AS (');
  assert.match(visits, /MIN\(alert\.alerted_at\) AS first_alerted_at,\s*\n\s*MAX\(alert\.tier\)::int AS max_tier/);
  assert.match(visits, /GROUP BY alert\.visit_id/);
  assert.match(visits, /visit\.id::bigint AS source_id/);
  // The period applies to the first alert, after the grouping.
  assert.match(visits, /WHERE alerts\.first_alerted_at >= \(/);
});

test('an undocumented visit resolves when it is closed, and a cancelled one has no time (DEC-ESC-4)', () => {
  const visits = between(query(), 'visit_undocumented AS (', 'visit_not_started AS (');
  assert.match(visits, /WHEN visit\.status IN \('in_progress', 'ended'\) THEN 'open'/);
  assert.match(visits, /WHEN visit\.status = 'cancelled' THEN 'cancelled'/);
  assert.match(visits, /CASE WHEN visit\.status IN \('in_progress', 'ended', 'cancelled'\) THEN NULL\s*\n\s*ELSE visit\.closed_at END AS resolved_at/);
  assert.match(visits, /NULL::int AS resolved_by_user_id/);
});

test('a not-started alert reads its own resolution', () => {
  const alerts = between(query(), 'visit_not_started AS (', 'cases AS (');
  assert.match(alerts, /CASE WHEN alert\.resolved_at IS NULL THEN 'open' ELSE 'resolved' END AS state/);
  assert.match(alerts, /alert\.responsible_user_id/);
});

test('duration runs to resolution, or to generation for an open case only', () => {
  const sql = query();
  assert.match(sql, /COALESCE\(cases\.resolved_at, CASE WHEN cases\.state = 'open' THEN NOW\(\) END\) - cases\.escalated_at/);
  assert.match(sql, /CASE WHEN cases\.state = 'open' AND NOW\(\) - cases\.escalated_at > INTERVAL '24 hours'\s*\n\s*THEN 'نعم' END AS "openOverDay"/);
});

test('scope: branch drops branchless requests, account creation is GLOBAL-only, ASSIGNED reads the responsible', () => {
  assert.doesNotMatch(query(), /cases\.branch_id = ANY|NOT cases\.global_only|cases\.responsible_user_id = \$/);

  const branch = build(RANGE, BRANCH_ACCESS);
  assert.match(branch.sql, /cases\.branch_id = ANY\(\$\d+::int\[\]\)/);
  assert.match(branch.sql, /NOT cases\.global_only/);
  assert.ok(branch.params.some(value => Array.isArray(value) && value[0] === 3 && value[1] === 7));

  const assigned = build(RANGE, ASSIGNED_ACCESS);
  assert.match(assigned.sql, /cases\.responsible_user_id = \$\d+/);
  assert.match(assigned.sql, /NOT cases\.global_only/);
  assert.ok(assigned.params.includes(42));

  assert.match(query(), /request\.request_type IN \('account_creation'\) AS global_only/);
});

test('the type filter tells request types from visit escalations, and refuses anything else', () => {
  const visit = build({ ...RANGE, escalationType: 'visit_undocumented' });
  assert.match(visit.sql, /cases\.source = \$\d+/);
  assert.ok(visit.params.includes('visit_undocumented'));

  const request = build({ ...RANGE, escalationType: 'sr:emergency_maintenance' });
  assert.match(request.sql, /cases\.source = 'service_request' AND cases\.request_type = \$\d+/);
  assert.ok(request.params.includes('emergency_maintenance'));

  assert.throws(() => query({ ...RANGE, escalationType: 'sr:x; DROP' }), /نوع التصعيد غير صالح/);
  assert.throws(() => query({ ...RANGE, escalationType: 'job_application' }), /نوع التصعيد غير صالح/);
  assert.deepEqual(Object.keys(VISIT_ESCALATION_TYPES), ['visit_undocumented', 'visit_not_started']);
});

test('the state filter splits open from ended', () => {
  assert.match(query({ ...RANGE, escalationState: 'open' }), /cases\.state = 'open'/);
  assert.match(query({ ...RANGE, escalationState: 'closed' }), /cases\.state <> 'open'/);
  assert.throws(() => query({ ...RANGE, escalationState: 'pending' }), /حالة التصعيد غير صالحة/);
});

test('the period is mandatory, ordered, and on the escalation moment', () => {
  assert.throws(() => query({}), /مدة التقرير مطلوبة/);
  assert.throws(() => query({ fromDate: '2026-08-31', toDate: '2026-08-01' }), /يجب ألا تكون بعد نهايتها/);
  const sql = query();
  assert.match(sql, /log\.created_at >= \(/);
  assert.match(sql, /alert\.alerted_at >= \(/);
});

test('the default order puts open cases first and ends on a unique key', () => {
  assert.match(query(), /ORDER BY CASE WHEN cases\.state = 'open' THEN 0 ELSE 1 END ASC, cases\.escalated_at ASC, cases\.source ASC, cases\.source_id ASC/);
  assert.match(query({ ...RANGE, sortKey: 'durationHours', sortDir: 'desc' }), /ORDER BY "durationHours" DESC NULLS LAST/);
  assert.throws(() => query({ ...RANGE, sortKey: 'source_id' }), /غير متاح للفرز/);
});

test('the catalog declares the report, its filters and every column', () => {
  const definition = findTabularReport('daily_work.escalations');
  assert.ok(definition);
  assert.equal(definition.groupKey, 'daily_work');
  assert.deepEqual(definition.supportedScopes, ['GLOBAL', 'BRANCH', 'ASSIGNED']);
  assert.equal(definition.filters.dateRange, 'required');
  assert.equal(definition.filters.escalationType, true);
  assert.equal(definition.filters.escalationState, true);
  assert.equal(definition.columns.length, 14);
  const sql = query();
  for (const column of definition.columns) {
    assert.match(sql, new RegExp(`AS "${column.key}"`), `${column.key} must be selected`);
    assert.ok(definition.guide.columnDescriptions[column.key], `${column.key} must be documented`);
  }
  // Both filter keys reach the report through the request contract.
  assert.ok((TABULAR_REQUEST_PARAM_KEYS as readonly string[]).includes('escalationType'));
  assert.ok((TABULAR_REQUEST_PARAM_KEYS as readonly string[]).includes('escalationState'));
});

test('the migration declares the permissions and a conservative baseline', () => {
  const migration = readFileSync('migrations/472_escalations_report.sql', 'utf8');
  assert.match(migration, /reports\.daily_work\.escalations\.view/);
  assert.match(migration, /reports\.daily_work\.escalations\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]::text\[\]/);
  assert.match(migration, /permission\.key = 'tasks\.supervisor_alerts\.view'/);
  // Export is never granted by the migration.
  assert.doesNotMatch(migration, /key = 'reports\.daily_work\.escalations\.export'\s*\n\s*\)/);
});
