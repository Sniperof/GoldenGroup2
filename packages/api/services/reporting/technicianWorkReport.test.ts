import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TECHNICIAN_TITLES_SETTING_KEY, buildTechnicianWorkQuery } from './technicianWorkReport.js';
import { columnsForGrantedScope, findTabularReport } from './tabularReportCatalog.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 42 };
const BRANCH_ACCESS = { scope: 'BRANCH' as const, grantedScope: 'BRANCH' as const, branchIds: [3, 7], userId: 42 };
const ASSIGNED_ACCESS = { scope: 'ASSIGNED' as const, grantedScope: 'ASSIGNED' as const, branchIds: [3], userId: 42 };
const RANGE = { fromDate: '2026-08-01', toDate: '2026-08-31' };

test('the rows come from the staff table, so a technician with no work still appears', () => {
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /\), report_rows AS \(\s*\n\s*SELECT employee\.id, employee\.branch_id, employee\.name,\s*\n\s*employee\.job_title, employee\.status, employee\.department_id\s*\n\s*FROM employees employee/);
  // Active technicians, plus anyone who did the work even after leaving.
  assert.match(sql, /employee\.status = 'active'\s*\n\s*AND BTRIM\(employee\.job_title\) IN \(SELECT job_title FROM technician_titles\)/);
  assert.match(sql, /OR EXISTS \(SELECT 1 FROM executed WHERE executed\.technician_id = employee\.id\)/);
  // No «unattributed» row: every executed task carries its technician.
  assert.doesNotMatch(sql, /غير منسوب/);
});

test('who counts as a technician is an admin setting, not a literal in the query', () => {
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.equal(TECHNICIAN_TITLES_SETTING_KEY, 'technician_job_titles');
  assert.match(sql, /FROM system_settings setting/);
  assert.match(sql, new RegExp(`setting\\.key = '${TECHNICIAN_TITLES_SETTING_KEY}'`));
  assert.doesNotMatch(sql, /job_title = 'فني صيانة'/);
});

test('the technician is the one who did the visit, after any reassignment', () => {
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /COALESCE\(visit\.reassigned_technician_id, NULLIF\(visit\.team_snapshot->>'technicianEmployeeId', ''\)::int\) AS technician_id/);
});

test('the due-date rule splits by overrun alone, and the two halves close on the total', () => {
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /AND \(executed\.closed_at AT TIME ZONE 'Asia\/Damascus'\)::date <= open_task\.due_date\)::int AS periodic_within/);
  assert.match(sql, /OR \(executed\.closed_at AT TIME ZONE 'Asia\/Damascus'\)::date > open_task\.due_date\)\)::int AS periodic_past_due/);
  // No window and no tolerance setting: early execution is inside the commitment.
  assert.doesNotMatch(sql, /INTERVAL '\d+ day/);
  assert.doesNotMatch(sql, /due_window/);
});

test('each population sits in its own lateral so no grain multiplies another', () => {
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  for (const lateral of [
    /\) tasks ON TRUE/, /\) periodic_money ON TRUE/, /\) emergency_money ON TRUE/,
    /\) dues ON TRUE/, /\) agreements ON TRUE/, /\) installs ON TRUE/,
    /\) sales ON TRUE/, /\) names ON TRUE/,
  ]) assert.match(sql, lateral);
});

test('money is what was collected, never what was merely charged', () => {
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /movement\.source_type = 'periodic_maintenance'\s*\n\s*AND movement\.kind = 'payment'/);
  assert.doesNotMatch(sql, /movement\.kind = 'charge'/);
  assert.match(sql, /SUM\(financials\.collected_amount\)/);
  assert.doesNotMatch(sql, /financials\.total_cost/);
  // Contract dues are split off, and the total excludes them by construction.
  assert.match(sql, /FILTER \(WHERE collection\.receivable_source_type = 'contract'\), 0\)::numeric AS contract_dues/);
  assert.match(sql, /FILTER \(WHERE collection\.receivable_source_type IS DISTINCT FROM 'contract'\), 0\)::numeric AS service_dues/);
  assert.match(sql, /\(COALESCE\(periodic_money\.collected, 0\) \+ COALESCE\(emergency_money\.collected, 0\)\s*\n\s*\+ COALESCE\(dues\.service_dues, 0\)\)::numeric AS "taskMoneyExcludingContractDues"/);
});

test('a service agreement is read from the task payload and never counted twice', () => {
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /SELECT DISTINCT payload\.service_agreement_id AS agreement_id/);
  assert.match(sql, /JOIN open_task_periodic_payload payload\s*\n\s*ON payload\.open_task_id = executed\.source_open_task_id/);
  // Reading it off the device would add the fee once per task performed on it.
  assert.doesNotMatch(sql, /service_agreements agreement ON agreement\.installed_device_id/);
});

test('installations resolve their contract through the open task, and only definitive ones count', () => {
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /ON contract\.id = COALESCE\(open_task\.contract_id, device\.contract_id\)/);
  assert.match(sql, /AND contract\.sale_subtype = 'definitive'\s*\n\s*AND contract\.status IN \('active', 'completed'\)/);
  // A contract with no seller is «someone else's sale», because the technician is not it.
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE contract\.sale_owner_id IS NULL\s*\n\s*OR contract\.sale_owner_id <> row\.id\)::int AS other_installs/);
});

test('the sales columns reuse the definitions the other reports use', () => {
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /contract\.sale_subtype = 'definitive'\s*\n\s*AND contract\.status IN \('active', 'completed'\)\)::int AS definitive_sales/);
  assert.match(sql, /contract\.sale_subtype = 'temporary'\s*\n\s*AND contract\.status <> 'cancelled'\)::int AS temporary_contracts/);
  // The varchar contract date keeps its shape guard and its text comparison.
  assert.match(sql, /contract\.contract_date ~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$'/);
  assert.match(sql, /contract\.contract_date >= \$\d+::text/);
});

test('the period is mandatory, ordered, and bounded by Damascus days', () => {
  assert.throws(() => buildTechnicianWorkQuery(GLOBAL_ACCESS, {}, { limit: 100 }), /مدة التقرير مطلوبة/);
  assert.throws(
    () => buildTechnicianWorkQuery(GLOBAL_ACCESS, { fromDate: '2026-08-31', toDate: '2026-08-01' }, { limit: 100 }),
    /يجب ألا تكون بعد نهايتها/,
  );
  assert.throws(() => buildTechnicianWorkQuery(GLOBAL_ACCESS, { ...RANGE, toDate: '2026-13-01' }, { limit: 100 }), /نهاية المدة غير صالح/);
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /result\.closed_at >= \([\s\S]{0,80}AT TIME ZONE 'Asia\/Damascus'/);
  assert.match(sql, /result\.closed_at < \(\(\$\d+::text::date \+ 1\)/);
});

test('scope is applied on the server for every supported mode', () => {
  assert.doesNotMatch(buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 }).sql, /employee\.branch_id = ANY/);

  const branch = buildTechnicianWorkQuery(BRANCH_ACCESS, RANGE, { limit: 100 });
  assert.match(branch.sql, /employee\.branch_id = ANY\(\$\d+::int\[\]\)/);
  assert.ok(branch.params.some(value => Array.isArray(value) && value[0] === 3 && value[1] === 7));

  const assigned = buildTechnicianWorkQuery(ASSIGNED_ACCESS, RANGE, { limit: 100 });
  assert.match(assigned.sql, /FROM hr_users scoped_user\s*\n\s*WHERE scoped_user\.id = \$\d+\s*\n\s*AND scoped_user\.employee_id = employee\.id/);

  const filtered = buildTechnicianWorkQuery(GLOBAL_ACCESS, { ...RANGE, technicianEmployeeId: 1086697 }, { limit: 100 });
  assert.match(filtered.sql, /AND employee\.id = \$\d+/);
  assert.ok(filtered.params.includes(1086697));
});

test('the default order is deterministic and ends on a unique key', () => {
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /ORDER BY COALESCE\(tasks\.total_done, 0\) DESC, row\.branch_id ASC NULLS LAST, row\.id ASC/);
  const sorted = buildTechnicianWorkQuery(GLOBAL_ACCESS, { ...RANGE, sortKey: 'periodicDone', sortDir: 'desc' }, { limit: 100 });
  assert.match(sorted.sql, /ORDER BY "periodicDone" DESC NULLS LAST/);
  assert.throws(() => buildTechnicianWorkQuery(GLOBAL_ACCESS, { ...RANGE, sortKey: 'technician_id' }, { limit: 100 }), /غير متاح للفرز/);
});

test('the catalog declares the report, its scopes, filter and every column', () => {
  const definition = findTabularReport('performance.technician_work');
  assert.ok(definition);
  assert.deepEqual(definition.supportedScopes, ['GLOBAL', 'BRANCH', 'ASSIGNED']);
  assert.equal(definition.filters.dateRange, 'required');
  assert.equal(definition.filters.technician, true);
  assert.equal(definition.rowIsBranch, true);
  assert.equal(definition.filters.department, true);
  assert.equal(definition.filters.jobTitle, true);
  assert.equal(definition.filters.employmentStatus, true);
  assert.equal(definition.filters.technicianActivity, true);
  assert.equal(definition.columns.length, 23);
  const { sql } = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  for (const column of definition.columns) {
    assert.match(sql, new RegExp(`AS "${column.key}"`), `${column.key} must be selected`);
    assert.ok(definition.guide.columnDescriptions[column.key], `${column.key} must be documented`);
  }
  assert.equal(columnsForGrantedScope(definition, 'GLOBAL').filter(c => c.key === 'branchName').length, 1);
});

test('the migration declares the permissions, the titles setting and its indexes', () => {
  const migration = readFileSync('migrations/456_technician_work_report.sql', 'utf8');
  assert.match(migration, /reports\.performance\.technician_work\.view/);
  assert.match(migration, /reports\.performance\.technician_work\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]::text\[\]/);
  assert.match(migration, /permission\.key = 'field_visits\.view'/);
  assert.match(migration, /'technician_job_titles'/);
  assert.match(migration, /idx_visit_task_results_closed_at/);
  assert.match(migration, /idx_employees_status_job_title/);
});

test('the staff dimension narrows which technicians appear, not what they did', () => {
  const { sql, params } = buildTechnicianWorkQuery(GLOBAL_ACCESS, {
    ...RANGE, departmentId: 4, jobTitle: 'فني صيانة', employmentStatus: 'inactive',
  }, { limit: 100 });

  // All three sit on the row source, so a technician who survives them keeps every
  // aggregate computed over her own whole period.
  assert.match(sql, /report_rows AS \([\s\S]*dimension_employee\.id = employee\.id[\s\S]*\)\s*\n\s*SELECT row\.branch_id/);
  assert.match(sql, /dimension_employee\.department_id = \$3/);
  assert.match(sql, /BTRIM\(dimension_employee\.job_title\) = \$4/);
  assert.match(sql, /dimension_employee\.status IS DISTINCT FROM 'active'/);
  assert.deepEqual(params.slice(0, 4), ['2026-08-01', '2026-08-31', 4, 'فني صيانة']);
});

test('the work-presence filter reads the same total the column shows', () => {
  const withWork = buildTechnicianWorkQuery(GLOBAL_ACCESS, { ...RANGE, technicianActivity: 'with_work' }, { limit: 100 });
  // Placed after the aggregate laterals, so it compares the published total and not
  // a second count of the same tasks.
  assert.match(withWork.sql, /\) names ON TRUE\s*\n\s*WHERE COALESCE\(tasks\.total_done, 0\) > 0/);
  assert.match(withWork.sql, /COALESCE\(tasks\.total_done, 0\) AS "totalExecutedTasks"/);

  const without = buildTechnicianWorkQuery(GLOBAL_ACCESS, { ...RANGE, technicianActivity: 'without_work' }, { limit: 100 });
  assert.match(without.sql, /WHERE COALESCE\(tasks\.total_done, 0\) = 0/);

  // Unasked, the staff list stays whole: a technician with no work is the finding.
  const plain = buildTechnicianWorkQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.doesNotMatch(plain.sql, /WHERE COALESCE\(tasks\.total_done/);
});

test('an unknown work-presence or employment value is refused', () => {
  assert.throws(
    () => buildTechnicianWorkQuery(GLOBAL_ACCESS, { ...RANGE, technicianActivity: 'busy' }, { limit: 100 }),
    /حالة العمل غير صالحة/,
  );
  assert.throws(
    () => buildTechnicianWorkQuery(GLOBAL_ACCESS, { ...RANGE, employmentStatus: 'retired' }, { limit: 100 }),
    /حالة الخدمة غير صالحة/,
  );
});
