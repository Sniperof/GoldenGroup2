import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildCustomerCallsQuery } from './customerCallsReport.js';
import { columnsForGrantedScope, findTabularReport } from './tabularReportCatalog.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 42 };
const BRANCH_ACCESS = { scope: 'BRANCH' as const, grantedScope: 'BRANCH' as const, branchIds: [3, 7], userId: 42 };
const ASSIGNED_ACCESS = { scope: 'ASSIGNED' as const, grantedScope: 'ASSIGNED' as const, branchIds: [3], userId: 42 };
const RANGE = { fromDate: '2026-08-01', toDate: '2026-08-31' };

test('the row is an employee inside a branch, and callers with no employee record collect', () => {
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /GROUP BY 1, 2/);
  assert.match(sql, /'غير منسوب إلى موظف'/);
  // The employee is resolved from the calling account, and a missing one is kept.
  assert.match(sql, /LEFT JOIN hr_users caller ON caller\.id = call_log\.caller_id/);
  // The two aggregates meet on the grain, nulls included.
  assert.match(sql, /task_totals\.employee_id IS NOT DISTINCT FROM call_totals\.employee_id/);
});

test('only one call table is read, because both hold the same telemarketing calls', () => {
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /FROM customer_call_logs call_log/);
  assert.doesNotMatch(sql, /telemarketing_call_logs/);
});

test('the call subject is the marked link, else the only link, else unknown', () => {
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /AND \(link\.is_primary\s*\n\s*OR \(SELECT COUNT\(\*\) FROM call_task_links solo WHERE solo\.call_id = call_log\.id\) = 1\)/);
  assert.match(sql, /ORDER BY link\.is_primary DESC, link\.task_id ASC\s*\n\s*LIMIT 1/);
  // An unknown subject is counted explicitly, never spread over the columns.
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE resolved\.task_type IS NULL\s*\n\s*OR resolved\.task_type NOT IN \('device_demo', 'periodic_maintenance'\)\)::int AS other_attempts/);
});

test('the frozen due date wins, and the live one is only a fallback for older links', () => {
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /COALESCE\(link\.task_due_date_snapshot, task\.due_date\) AS due_at_call/);
  // The comparison is a Damascus day on both sides, and only for booking calls.
  assert.match(sql, /WHERE resolved\.is_booking AND resolved\.due_at_call IS NOT NULL\s*\n\s*AND \(resolved\.call_date AT TIME ZONE 'Asia\/Damascus'\)::date <= resolved\.due_at_call/);
  assert.match(sql, /AND \(resolved\.call_date AT TIME ZONE 'Asia\/Damascus'\)::date > resolved\.due_at_call/);
});

test('attempts count calls while appointments count distinct tasks', () => {
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  // booked_tasks groups by task, so a task called twice is one appointment.
  assert.match(sql, /\), booked_tasks AS \([\s\S]*?GROUP BY 1, 2, 3, 4/);
  assert.match(sql, /WHERE resolved\.is_booking AND resolved\.task_id IS NOT NULL/);
  // ... while the attempt columns count the calls themselves.
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE resolved\.task_type = 'device_demo'\)::int AS marketing_attempts/);
});

test('the sale, execution and collection facts hang off the booked task', () => {
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /WHERE visit_task\.source_open_task_id = resolved\.task_id\s*\n\s*\) AS executed/);
  assert.match(sql, /contract\.source_open_task_id = resolved\.task_id/);
  assert.match(sql, /contract\.status IN \('active', 'completed'\)/);
  assert.match(sql, /contract\.sale_subtype = 'definitive'/);
  assert.match(sql, /collection\.paid_amount_syp > 0/);
  // The total is the two halves, never a third source.
  assert.match(sql, /\(COALESCE\(task_totals\.marketing_sales, 0\) \+ COALESCE\(task_totals\.service_sales, 0\)\) AS "totalSales"/);
});

test('the appointment block closes: marketing + periodic + other = the total', () => {
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  // The «other» buckets exist so no unexplained gap sits between the visible
  // blocks and the totals — the same reason «other attempts» exists on the call side.
  assert.match(sql, /NOT IN \('device_demo', 'periodic_maintenance'\)\)::int AS other_appointments/);
  assert.match(sql, /NOT IN \('device_demo', 'periodic_maintenance'\)\s*\n\s*AND booked_tasks\.executed\)::int AS other_executed/);
  // Every bucket partitions the same population, so the parts cannot overlap.
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE booked_tasks\.task_type = 'device_demo'\)::int AS marketing_appointments/);
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE booked_tasks\.task_type = 'periodic_maintenance'\)::int AS periodic_appointments/);
  assert.match(sql, /COUNT\(\*\)::int AS total_appointments/);
});

test('every rate is empty rather than zero when its denominator is', () => {
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  for (const rate of ['demoExecutionRate', 'periodicExecutionRate', 'overallExecutionRate', 'callsPerActiveDay']) {
    assert.match(sql, new RegExp(`CASE WHEN[\\s\\S]{0,200}> 0[\\s\\S]{0,200}END AS "${rate}"`));
  }
});

test('the daily rate divides by days the employee actually logged a call', () => {
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /COUNT\(DISTINCT \(resolved\.call_date AT TIME ZONE 'Asia\/Damascus'\)::date\)::int AS active_days/);
  assert.match(sql, /call_totals\.total_calls::numeric \/ call_totals\.active_days/);
});

test('the period is mandatory, ordered, and bounded by Damascus days', () => {
  assert.throws(() => buildCustomerCallsQuery(GLOBAL_ACCESS, {}, { limit: 100 }), /مدة التقرير مطلوبة/);
  assert.throws(
    () => buildCustomerCallsQuery(GLOBAL_ACCESS, { fromDate: '2026-08-31', toDate: '2026-08-01' }, { limit: 100 }),
    /يجب ألا تكون بعد نهايتها/,
  );
  assert.throws(() => buildCustomerCallsQuery(GLOBAL_ACCESS, { ...RANGE, fromDate: '01-08-2026' }, { limit: 100 }), /بداية المدة غير صالح/);
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /call_log\.call_date >= \([\s\S]{0,80}AT TIME ZONE 'Asia\/Damascus'/);
  // The upper bound is exclusive on the next day, so the last day is whole.
  assert.match(sql, /call_log\.call_date < \(\(\$\d+::text::date \+ 1\)/);
});

test('scope is applied on the server for every supported mode', () => {
  assert.doesNotMatch(buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 }).sql, /call_log\.branch_id = ANY/);

  const branch = buildCustomerCallsQuery(BRANCH_ACCESS, RANGE, { limit: 100 });
  assert.match(branch.sql, /call_log\.branch_id = ANY\(\$\d+::int\[\]\)/);
  assert.ok(branch.params.some(value => Array.isArray(value) && value[0] === 3 && value[1] === 7));

  const assigned = buildCustomerCallsQuery(ASSIGNED_ACCESS, RANGE, { limit: 100 });
  assert.match(assigned.sql, /scoped_user\.employee_id IS NOT NULL\s*\n\s*AND scoped_user\.employee_id = caller\.employee_id/);
});

test('the employee and outcome filters narrow the same population', () => {
  const { sql } = buildCustomerCallsQuery(
    GLOBAL_ACCESS, { ...RANGE, employeeId: 1204174, callOutcome: 'no_answer' }, { limit: 100 },
  );
  assert.match(sql, /AND caller\.employee_id = \$\d+/);
  assert.match(sql, /AND call_log\.outcome = \$\d+/);
  // An unknown outcome is bound as a parameter, never interpolated.
  const injected = buildCustomerCallsQuery(GLOBAL_ACCESS, { ...RANGE, callOutcome: "x' OR 1=1--" }, { limit: 100 });
  assert.doesNotMatch(injected.sql, /OR 1=1/);
  assert.ok(injected.params.includes("x' OR 1=1--"));
});

test('the default order is deterministic and ends on a unique key', () => {
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /ORDER BY call_totals\.total_calls DESC, call_totals\.branch_id ASC NULLS LAST, call_totals\.employee_id ASC NULLS LAST/);
  const sorted = buildCustomerCallsQuery(GLOBAL_ACCESS, { ...RANGE, sortKey: 'totalCalls', sortDir: 'desc' }, { limit: 100 });
  assert.match(sorted.sql, /ORDER BY "totalCalls" DESC NULLS LAST/);
  assert.throws(() => buildCustomerCallsQuery(GLOBAL_ACCESS, { ...RANGE, sortKey: 'caller_id' }, { limit: 100 }), /غير متاح للفرز/);
});

test('the catalog declares the report, its scopes, filters and every column', () => {
  const definition = findTabularReport('performance.customer_calls');
  assert.ok(definition);
  assert.deepEqual(definition.supportedScopes, ['GLOBAL', 'BRANCH', 'ASSIGNED']);
  assert.equal(definition.filters.dateRange, 'required');
  assert.equal(definition.filters.callEmployee, true);
  assert.equal(definition.filters.callOutcome, true);
  assert.equal(definition.rowIsBranch, true);
  assert.equal(definition.columns.length, 26);
  const { sql } = buildCustomerCallsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  for (const column of definition.columns) {
    assert.match(sql, new RegExp(`AS "${column.key}"`), `${column.key} must be selected`);
    assert.ok(definition.guide.columnDescriptions[column.key], `${column.key} must be documented`);
  }
  // The branch is part of the row identity, so GLOBAL must not inject a second one.
  assert.equal(columnsForGrantedScope(definition, 'GLOBAL').filter(c => c.key === 'branchName').length, 1);
});

test('the migration declares both permissions with ASSIGNED and adds its indexes', () => {
  const migration = readFileSync('migrations/455_customer_calls_report.sql', 'utf8');
  assert.match(migration, /reports\.performance\.customer_calls\.view/);
  assert.match(migration, /reports\.performance\.customer_calls\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]::text\[\]/);
  // The baseline is derived from seeing the call log, and export is not granted.
  assert.match(migration, /permission\.key = 'clients\.call_log\.view'/);
  assert.doesNotMatch(migration, /customer_calls\.export'\s*\)\s*INSERT INTO public\.role_permission_grants/);
  assert.match(migration, /idx_customer_call_logs_branch_date/);
  assert.match(migration, /idx_customer_call_logs_caller/);
});
