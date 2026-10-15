import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SUPERVISOR_TITLES_SETTING_KEY, buildSupervisorWorkQuery } from './supervisorWorkReport.js';
import { columnsForGrantedScope, findTabularReport } from './tabularReportCatalog.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 42 };
const BRANCH_ACCESS = { scope: 'BRANCH' as const, grantedScope: 'BRANCH' as const, branchIds: [3, 7], userId: 42 };
const ASSIGNED_ACCESS = { scope: 'ASSIGNED' as const, grantedScope: 'ASSIGNED' as const, branchIds: [3], userId: 42 };
const RANGE = { fromDate: '2026-08-01', toDate: '2026-08-31' };

const query = (request: Record<string, unknown> = RANGE) =>
  buildSupervisorWorkQuery(GLOBAL_ACCESS, request, { limit: 100 }).sql;

test('the rows come from the staff table, so a supervisor with no work still appears', () => {
  const sql = query();
  assert.match(sql, /report_rows AS \(\s*\n\s*SELECT employee\.id, employee\.branch_id, employee\.name,/);
  assert.match(sql, /employee\.status = 'active'\s*\n\s*AND BTRIM\(employee\.job_title\) IN \(SELECT job_title FROM supervisor_titles\)/);
  // Anyone who was a visit's supervisor in the period appears, even after leaving —
  // whether the work was done or only scheduled.
  assert.match(sql, /OR EXISTS \(SELECT 1 FROM executed WHERE executed\.supervisor_id = employee\.id\)/);
  assert.match(sql, /OR EXISTS \(SELECT 1 FROM scheduled WHERE scheduled\.supervisor_id = employee\.id\)/);
  assert.doesNotMatch(sql, /غير منسوب/);
});

test('who counts as a supervisor is an admin setting, not a literal in the query', () => {
  const sql = query();
  assert.equal(SUPERVISOR_TITLES_SETTING_KEY, 'supervisor_job_titles');
  assert.match(sql, new RegExp(`setting\\.key = '${SUPERVISOR_TITLES_SETTING_KEY}'`));
  assert.doesNotMatch(sql, /job_title = 'مشرفة'/);
});

test('the supervisor is the visit\'s, after any reassignment, on both time axes', () => {
  const sql = query();
  const matches = sql.match(/COALESCE\(visit\.reassigned_supervisor_id, NULLIF\(visit\.team_snapshot->>'supervisorEmployeeId', ''\)::int\) AS supervisor_id/g);
  assert.equal(matches?.length, 2);
});

test('scheduled work reads the visit date, done work reads the close date (DEC-SW-2)', () => {
  const sql = query();
  assert.match(sql, /scheduled AS \([\s\S]*WHERE visit\.scheduled_date >= \$\d+::date\s*\n\s*AND visit\.scheduled_date <= \$\d+::date/);
  assert.match(sql, /executed AS \([\s\S]*WHERE result\.closed_at >= \(/);
  // Scheduled counts tasks in any status: no status filter on the scheduled population.
  const scheduledCte = sql.slice(sql.indexOf('scheduled AS ('), sql.indexOf('report_rows AS ('));
  assert.doesNotMatch(scheduledCte, /task\.status/);
  // An instant visit with no task still counts, so tasks are left-joined.
  assert.match(scheduledCte, /LEFT JOIN visit_tasks task ON task\.field_visit_id = visit\.id/);
});

test('field days and instant visits come from the scheduled population', () => {
  const sql = query();
  assert.match(sql, /COUNT\(scheduled\.visit_task_id\)::int AS scheduled_tasks/);
  assert.match(sql, /COUNT\(DISTINCT scheduled\.scheduled_date\)\s*\n\s*FILTER \(WHERE scheduled\.visit_task_id IS NOT NULL\)::int AS field_days/);
  assert.match(sql, /COUNT\(DISTINCT scheduled\.visit_id\)\s*\n\s*FILTER \(WHERE scheduled\.origin_type = 'field_initiated'\)::int AS instant_visits/);
});

test('the two ratios are empty, not zero, when their denominator is zero', () => {
  const sql = query();
  assert.match(sql, /CASE WHEN COALESCE\(plan\.scheduled_tasks, 0\) = 0 THEN NULL\s*\n\s*ELSE ROUND\(COALESCE\(tasks\.total_done, 0\) \* 100\.0 \/ plan\.scheduled_tasks, 1\)\s*\n\s*END AS "executionRate"/);
  assert.match(sql, /CASE WHEN COALESCE\(tasks\.total_done, 0\) = 0 THEN NULL\s*\n\s*ELSE ROUND\(COALESCE\(names\.candidates_added, 0\)::numeric \/ tasks\.total_done, 2\)\s*\n\s*END AS "candidatesPerExecutedTask"/);
});

test('instant-visit offers are a subset of offers, and their sales go by the contract behind them', () => {
  const sql = query();
  assert.match(sql, /FILTER \(WHERE executed\.task_type = 'device_demo'\s*\n\s*AND executed\.origin_type = 'field_initiated'\)::int AS instant_demos/);
  assert.match(sql, /offer_contract\.id = demo\.contract_id/);
  assert.match(sql, /AND offer_contract\.sale_reference_number = demo\.sale_reference_number/);
  // The seller on the contract plays no part in an instant sale (DEC-SW-1).
  const instant = sql.slice(sql.indexOf('AS instant_demos'), sql.indexOf('AS instant_sales'));
  assert.doesNotMatch(instant, /sale_owner_id/);
});

test('sales are the ones she owns as seller, with each sale\'s first payment (DEC-SW-1)', () => {
  const sql = query();
  assert.match(sql, /WHERE contract\.sale_owner_id = row\.id/);
  assert.match(sql, /contract\.sale_subtype = 'definitive'\s*\n\s*AND contract\.status IN \('active', 'completed'\)\)::int AS definitive_sales/);
  assert.match(sql, /ORDER BY movement\.occurred_at ASC, movement\.id ASC\s*\n\s*LIMIT 1\s*\n\s*\) first_payment ON TRUE/);
  assert.match(sql, /movement\.source_type IN \('contract', 'contract_installment', 'contract_payment'\)/);
  assert.match(sql, /AS first_payments/);
});

test('warranty money goes to who received it, net of refunds (DEC-SW-4)', () => {
  const sql = query();
  assert.match(sql, /FROM device_warranty_payments payment\s*\n\s*WHERE payment\.received_by_employee_id = row\.id/);
  assert.match(sql, /WHEN payment\.entry_type = 'refund'\s*\n\s*THEN -payment\.amount_syp/);
  assert.match(sql, /payment\.received_at >= \(/);
  // Not through the offer visit's team.
  assert.doesNotMatch(sql, /offer_team/);
});

test('maintenance money is collected money only, and contract dues are left out', () => {
  const sql = query();
  assert.match(sql, /movement\.source_type = 'periodic_maintenance'\s*\n\s*AND movement\.kind = 'payment'/);
  assert.doesNotMatch(sql, /movement\.kind = 'charge'/);
  assert.match(sql, /\(COALESCE\(periodic_money\.collected, 0\) \+ COALESCE\(emergency_money\.collected, 0\)\)::numeric AS "maintenanceCollected"/);
  assert.match(sql, /COALESCE\(dues\.service_dues, 0\)::numeric AS "serviceDuesCollected"/);
  assert.doesNotMatch(sql, /AS "contractDuesCollected"/);
});

test('the due-date rule splits by overrun alone', () => {
  const sql = query();
  assert.match(sql, /AND \(executed\.closed_at AT TIME ZONE 'Asia\/Damascus'\)::date <= open_task\.due_date\)::int AS periodic_within/);
  assert.match(sql, /OR \(executed\.closed_at AT TIME ZONE 'Asia\/Damascus'\)::date > open_task\.due_date\)\)::int AS periodic_past_due/);
});

test('each population sits in its own lateral so no grain multiplies another', () => {
  const sql = query();
  for (const lateral of [
    /\) plan ON TRUE/, /\) tasks ON TRUE/, /\) periodic_money ON TRUE/, /\) emergency_money ON TRUE/,
    /\) dues ON TRUE/, /\) agreements ON TRUE/, /\) warranty_money ON TRUE/, /\) sales ON TRUE/, /\) names ON TRUE/,
  ]) assert.match(sql, lateral);
  // The laterals shared with the technician report read the supervisor column.
  assert.doesNotMatch(sql, /technician_id/);
});

test('the period is mandatory, ordered, and valid', () => {
  assert.throws(() => query({}), /مدة التقرير مطلوبة/);
  assert.throws(() => query({ fromDate: '2026-08-31', toDate: '2026-08-01' }), /يجب ألا تكون بعد نهايتها/);
  assert.throws(() => query({ ...RANGE, toDate: '2026-13-01' }), /نهاية المدة غير صالح/);
});

test('scope is applied on the server for every supported mode', () => {
  assert.doesNotMatch(query(), /employee\.branch_id = ANY/);

  const branch = buildSupervisorWorkQuery(BRANCH_ACCESS, RANGE, { limit: 100 });
  assert.match(branch.sql, /employee\.branch_id = ANY\(\$\d+::int\[\]\)/);
  assert.ok(branch.params.some(value => Array.isArray(value) && value[0] === 3 && value[1] === 7));

  const assigned = buildSupervisorWorkQuery(ASSIGNED_ACCESS, RANGE, { limit: 100 });
  assert.match(assigned.sql, /FROM hr_users scoped_user\s*\n\s*WHERE scoped_user\.id = \$\d+\s*\n\s*AND scoped_user\.employee_id = employee\.id/);

  const filtered = buildSupervisorWorkQuery(GLOBAL_ACCESS, { ...RANGE, supervisorEmployeeId: 1226838 }, { limit: 100 });
  assert.match(filtered.sql, /AND employee\.id = \$\d+/);
  assert.ok(filtered.params.includes(1226838));
});

test('the work-presence filter reads the same total the column shows', () => {
  assert.match(query({ ...RANGE, technicianActivity: 'with_work' }), /\) names ON TRUE\s*\n\s*WHERE COALESCE\(tasks\.total_done, 0\) > 0/);
  assert.match(query({ ...RANGE, technicianActivity: 'without_work' }), /WHERE COALESCE\(tasks\.total_done, 0\) = 0/);
  assert.doesNotMatch(query(), /WHERE COALESCE\(tasks\.total_done/);
  assert.throws(() => query({ ...RANGE, technicianActivity: 'busy' }), /حالة العمل غير صالحة/);
});

test('the default order is deterministic and ends on a unique key', () => {
  assert.match(query(), /ORDER BY COALESCE\(tasks\.total_done, 0\) DESC, row\.branch_id ASC NULLS LAST, row\.id ASC/);
  assert.match(query({ ...RANGE, sortKey: 'fieldDays', sortDir: 'desc' }), /ORDER BY "fieldDays" DESC NULLS LAST/);
  assert.throws(() => query({ ...RANGE, sortKey: 'supervisor_id' }), /غير متاح للفرز/);
});

test('the catalog declares the report, its scopes, filters and every column', () => {
  const definition = findTabularReport('performance.supervisor_work');
  assert.ok(definition);
  assert.equal(definition.groupKey, 'daily_work');
  assert.deepEqual(definition.supportedScopes, ['GLOBAL', 'BRANCH', 'ASSIGNED']);
  assert.equal(definition.filters.dateRange, 'required');
  assert.equal(definition.filters.supervisor, true);
  assert.equal(definition.filters.technician, false);
  assert.equal(definition.filters.technicianActivity, true);
  // 24 contract columns (§8) + job title, department and employment status for context.
  assert.equal(definition.columns.length, 27);
  const sql = query();
  for (const column of definition.columns) {
    assert.match(sql, new RegExp(`AS "${column.key}"`), `${column.key} must be selected`);
    assert.ok(definition.guide.columnDescriptions[column.key], `${column.key} must be documented`);
  }
  assert.equal(columnsForGrantedScope(definition, 'GLOBAL').filter(c => c.key === 'branchName').length, 1);
});

test('the migration declares the permissions, the titles setting and its indexes', () => {
  const migration = readFileSync('migrations/471_supervisor_work_report.sql', 'utf8');
  assert.match(migration, /reports\.performance\.supervisor_work\.view/);
  assert.match(migration, /reports\.performance\.supervisor_work\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]::text\[\]/);
  assert.match(migration, /permission\.key = 'field_visits\.view'/);
  assert.match(migration, /'supervisor_job_titles', '\["مشرفة"\]'/);
  assert.match(migration, /idx_field_visits_scheduled_date/);
  // Without it the names lateral scans every candidate once per row (35s → 10ms).
  assert.match(migration, /idx_candidates_owner_created_at\s*\n\s*ON public\.candidates \(owner_user_id, created_at\)/);
  assert.match(migration, /idx_device_warranty_payments_receiver_received_at/);
});
