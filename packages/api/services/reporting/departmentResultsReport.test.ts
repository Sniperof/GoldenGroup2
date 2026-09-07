import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDepartmentResultsQuery, paceFactor } from './departmentResultsReport.js';
import { findTabularReport, columnsForGrantedScope } from './tabularReportCatalog.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 42 };
const BRANCH_ACCESS = { scope: 'BRANCH' as const, grantedScope: 'BRANCH' as const, branchIds: [3, 7], userId: 42 };
const RANGE = { fromDate: '2026-08-01', toDate: '2026-08-31' };

test('the row is a department, plus one unattributed row per branch that hides when empty', () => {
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /FROM departments dept\s*\n\s*JOIN scope_branches branch/);
  assert.match(sql, /UNION ALL\s*\n\s*SELECT NULL::int, branch\.id, 'غير منسوب إلى قسم'/);
  // The unattributed row survives only when it actually carries work.
  assert.match(sql, /WHERE row\.department_id IS NOT NULL\s*\n\s*OR COALESCE\(sellers\.seller_count, 0\)/);
});

test('every population resolves its own department and matches it against the row', () => {
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  for (const column of [
    'emp.department_id', 'performer.department_id', 'owner_employee.department_id',
    'owner.department_id', 'money_owner.department_id',
  ]) {
    const escaped = column.replaceAll('.', '\\.');
    assert.match(sql, new RegExp(
      `CASE WHEN row\\.department_id IS NULL THEN ${escaped} IS NULL ELSE ${escaped} = row\\.department_id END`,
    ), `${column} must be matched against the row department`);
  }
});

test('each population sits in its own lateral so no grain multiplies another', () => {
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  for (const lateral of [
    /\) sellers ON TRUE/, /\) demos ON TRUE/, /\) names ON TRUE/,
    /\) sales ON TRUE/, /\) periodic ON TRUE/, /\) money ON TRUE/,
  ]) assert.match(sql, lateral);
  assert.doesNotMatch(sql, /GROUP BY row\./);
});

test('the period is mandatory and ordered, and the varchar contract date keeps its own cast', () => {
  assert.throws(() => buildDepartmentResultsQuery(GLOBAL_ACCESS, {}, { limit: 100 }), /مدة التقرير مطلوبة/);
  assert.throws(
    () => buildDepartmentResultsQuery(GLOBAL_ACCESS, { fromDate: '2026-08-31', toDate: '2026-08-01' }, { limit: 100 }),
    /يجب ألا تكون بعد نهايتها/,
  );
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  // The same parameter feeds a varchar column and real date columns, so each use
  // site casts explicitly; otherwise PostgreSQL resolves it once and the other
  // comparison fails with «character varying >= date».
  assert.match(sql, /contract\.contract_date >= \$1::text/);
  assert.match(sql, /visit\.scheduled_date >= \$1::text::date/);
  assert.match(sql, /contract\.contract_date ~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$'/);
});

test('the seller role is mapped per department type, and unmapped types read empty', () => {
  const { sql, params } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  // «عدد البائع» is a dealer in marketing and a supervisor in customer service, so the
  // titles come from the department type's metadata and never from a constant here.
  assert.match(sql, /JSONB_TYPEOF\(dept_type\.metadata->'sellerJobTitles'\) = 'array'/);
  assert.match(sql, /ARRAY\(SELECT JSONB_ARRAY_ELEMENTS_TEXT\(dept_type\.metadata->'sellerJobTitles'\)\)/);
  assert.match(sql, /FROM employees emp[\s\S]*emp\.status = 'active'[\s\S]*emp\.job_title = ANY\(row\.seller_titles\)/);
  // A type with no mapping yields NULL, not zero: «no seller role defined here» is
  // not «zero sellers», and the unattributed row never claims a seller count.
  assert.match(sql, /CASE WHEN row\.seller_titles IS NULL THEN NULL::int ELSE/);
  assert.match(sql, /SELECT NULL::int, branch\.id, 'غير منسوب إلى قسم', NULL::text\[\]/);
  assert.doesNotMatch(sql, /COALESCE\(sellers\.seller_count, 0\) AS "dealerCount"/);
  // No job title is bound as a parameter any more.
  assert.equal(params.includes('ديلر'), false);
});

test('executed demos are a subset of scheduled demos, so the offer rate cannot exceed 100', () => {
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /COUNT\(\*\)::int AS scheduled_demos,\s*\n\s*COUNT\(result\.id\)::int AS executed_demos/);
  assert.match(sql, /task\.task_type = 'device_demo'/);
  assert.match(sql, /THEN ROUND\(demos\.executed_demos \* 100\.0 \/ demos\.scheduled_demos, 1\) END AS "offerRate"/);
});

test('names are attributed through the name owner and bounded by Damascus days', () => {
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /FROM candidates candidate[\s\S]*owner_account\.id = candidate\.owner_user_id/);
  assert.match(sql, /candidate\.created_at >= \(\$1::text \|\| ' 00:00'\)::timestamp AT TIME ZONE 'Asia\/Damascus'/);
  assert.match(sql, /candidate\.created_at < \(\(\$2::text::date \+ 1\)::text \|\| ' 00:00'\)::timestamp AT TIME ZONE 'Asia\/Damascus'/);
});

test('sales count definitive contracts only, by stored family and stored points', () => {
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /contract\.sale_subtype = 'definitive'/);
  assert.match(sql, /contract\.status IN \('active', 'completed'\)/);
  assert.match(sql, /COALESCE\(SUM\(model\.sale_points\), 0\)::numeric AS sales_points/);
  for (const family of ['challenger', 'double_membrane', 'aquanova', 'safe_life', 'golden']) {
    assert.match(sql, new RegExp(`model\\.sale_family = '${family}'`), `${family} column must read the stored family`);
  }
  // The requested header merges the two families into one column.
  assert.match(sql, /model\.sale_family IN \('softener', 'station'\)/);
  // The family never comes from matching the model name at query time.
  assert.doesNotMatch(sql, /model\.name ILIKE/);
});

test('the three money columns are cash and cannot double count', () => {
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /WHERE movement\.source_type NOT IN \('contract', 'contract_installment', 'contract_payment'\)\), 0\)::numeric AS service_revenue/);
  // Receivables are contract money after the first payment: the first payment is the
  // one with no earlier payment, and it is already counted as «مبالغ مبيعات».
  assert.match(sql, /AND EXISTS \(\s*\n\s*SELECT 1 FROM financial_movements earlier[\s\S]*\(earlier\.occurred_at, earlier\.id\) < \(movement\.occurred_at, movement\.id\)/);
  assert.match(sql, /\(COALESCE\(sales\.first_payment_total, 0\) \+ COALESCE\(money\.service_revenue, 0\)\s*\n\s*\+ COALESCE\(money\.receivables_revenue, 0\)\)::numeric AS "totalRevenue"/);
  assert.match(sql, /movement\.kind = 'payment'/);
});

test('the first payment of a contract is read from contract money sources only', () => {
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /FROM financial_movements movement[\s\S]*movement\.source_type IN \('contract', 'contract_installment', 'contract_payment'\)[\s\S]*ORDER BY movement\.occurred_at ASC, movement\.id ASC\s*\n\s*LIMIT 1/);
});

test('completed periodic work is counted by its closing result and its performer', () => {
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /task\.task_type = 'periodic_maintenance'\s*\n\s*AND task\.status = 'completed'/);
  assert.match(sql, /result\.closed_at >= \(\$1::text/);
  assert.match(sql, /performer\.id = COALESCE\(COALESCE\(visit\.reassigned_technician_id/);
});

test('pace projects the month from the requested end date, and stays empty across months', () => {
  assert.equal(paceFactor('2026-08-01', '2026-08-31'), 1);
  assert.equal(paceFactor('2026-08-01', '2026-08-15'), 31 / 15);
  assert.equal(paceFactor('2026-02-01', '2026-02-10'), 28 / 10);
  assert.equal(paceFactor('2026-07-01', '2026-08-15'), null);

  const sameMonth = buildDepartmentResultsQuery(GLOBAL_ACCESS, { fromDate: '2026-08-01', toDate: '2026-08-15' }, { limit: 100 });
  assert.match(sameMonth.sql, /ROUND\(COALESCE\(sales\.definitive_sales, 0\) \* \$\d+::numeric, 2\) AS "pace"/);
  assert.equal(sameMonth.params.includes(31 / 15), true);

  const crossMonth = buildDepartmentResultsQuery(GLOBAL_ACCESS, { fromDate: '2026-07-01', toDate: '2026-08-15' }, { limit: 100 });
  assert.match(crossMonth.sql, /NULL::numeric AS "pace"/);
});

test('branch scope narrows the subject before any population is aggregated', () => {
  const { sql, params } = buildDepartmentResultsQuery(BRANCH_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /SELECT branch\.id, branch\.name FROM branches branch WHERE branch\.id = ANY\(\$1::int\[\]\)/);
  assert.deepEqual(params[0], [3, 7]);
});

test('the department type filter binds to the managed type and rejects a bad value', () => {
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, { ...RANGE, departmentTypeId: '36' }, { limit: 100 });
  assert.match(sql, /AND dept\.department_type_id = \$3/);
  const ignored = buildDepartmentResultsQuery(GLOBAL_ACCESS, { ...RANGE, departmentTypeId: 'x' }, { limit: 100 });
  assert.doesNotMatch(ignored.sql, /AND dept\.department_type_id = \$/);
});

test('selected devices add their own columns on top of the fixed family columns', () => {
  const none = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.doesNotMatch(none.sql, /deviceModel_/);
  const picked = buildDepartmentResultsQuery(GLOBAL_ACCESS, { ...RANGE, deviceModelIds: '1195,2462' }, { limit: 100 });
  assert.match(picked.sql, /AS "deviceModel_1195"/);
  assert.match(picked.sql, /AS "selectedDevicesTotal"/);
  assert.match(picked.sql, /AS "challengerSales"/);
});

test('ordering is total and ends with a unique tie breaker', () => {
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /ORDER BY COALESCE\(sales\.first_payment_total, 0\) DESC, row\.branch_id ASC, row\.department_id ASC NULLS LAST/);
  assert.throws(
    () => buildDepartmentResultsQuery(GLOBAL_ACCESS, { ...RANGE, sortKey: 'dealer' }, { limit: 100 }),
    /غير متاح للفرز/,
  );
});

test('the catalog declares the requested 22 columns with no duplicate branch column', () => {
  const definition = findTabularReport('performance.department_results');
  assert.ok(definition);
  assert.equal(definition.groupKey, 'daily_work');
  assert.equal(definition.rowIsBranch, true);
  assert.deepEqual(definition.supportedScopes, ['GLOBAL', 'BRANCH']);
  assert.equal(definition.columns.length, 22);

  const globalColumns = columnsForGrantedScope(definition, 'GLOBAL');
  assert.equal(globalColumns.filter(column => column.key === 'branchName').length, 1);
  assert.equal(globalColumns.length, columnsForGrantedScope(definition, 'BRANCH').length);
  for (const column of globalColumns) {
    assert.ok(definition.guide.columnDescriptions[column.key], `missing guide text for ${column.key}`);
  }
  assert.ok(definition.guide.columnDescriptions.selectedDevicesTotal);
  // §9.7.5: selection filters only.
  assert.notEqual(definition.filters.search, true);
});

test('every catalog column is selected by the query and nothing extra leaks', () => {
  const definition = findTabularReport('performance.department_results');
  assert.ok(definition);
  const { sql } = buildDepartmentResultsQuery(GLOBAL_ACCESS, RANGE, { limit: 100, includeTotalRows: false });
  const selected = new Set(Array.from(sql.matchAll(/AS "([A-Za-z]+)"/g), match => match[1]));
  for (const column of columnsForGrantedScope(definition, 'GLOBAL')) {
    assert.equal(selected.has(column.key), true, `column ${column.key} is not selected by the query`);
  }
  selected.delete('branchId');
  selected.delete('departmentId');
  assert.equal(selected.size, definition.columns.length);
});

test('the seller titles migration maps the two selling department types', () => {
  const migration = readFileSync('migrations/452_department_seller_titles.sql', 'utf8');
  assert.match(migration, /sellerJobTitles/);
  assert.match(migration, /jsonb_build_array\('ديلر', 'مندوب التسويق'\)/);
  assert.match(migration, /jsonb_build_array\('مشرفة'\)/);
  assert.match(migration, /value = 'تسويق و مبيعات'/);
  assert.match(migration, /value = 'صيانة و خدمة العملاء'/);
  // The mapping is merged into the existing metadata, so canSelectDevice survives.
  assert.match(migration, /metadata \|\| jsonb_build_object/);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
});

test('the migration seeds the approved family mapping and guards it in the schema', () => {
  const migration = readFileSync('migrations/451_department_results_report.sql', 'utf8');
  assert.match(migration, /reports\.performance\.department_results\.view/);
  assert.match(migration, /reports\.performance\.department_results\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH'\]::text\[\]/);
  assert.match(migration, /grant_row\.scope_type IN \('GLOBAL', 'BRANCH'\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS sale_family VARCHAR\(20\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS sale_points NUMERIC\(4,2\)/);
  assert.match(migration, /CHECK \(sale_family IS NULL OR sale_family IN/);
  // The six approved families, and the weights the user set.
  for (const family of ['challenger', 'aquanova', 'double_membrane', 'softener', 'station', 'safe_life', 'golden']) {
    assert.match(migration, new RegExp(`'${family}'`), `${family} must be in the guarded family list`);
  }
  assert.match(migration, /\(1195, 'challenger', 1\.00\)/);
  assert.match(migration, /\(2462, 'aquanova', 1\.00\)/);
  assert.match(migration, /\(2375, 'golden', 0\.50\)/);
  assert.match(migration, /\(1300, 'safe_life', 0\.50\)/);
  // The models the user excluded carry no weight, so they are absent from the seed.
  for (const excluded of ['1001', '1006', '1007', '1010', '1013', '1023', '1187', '1189', '1190', '1191']) {
    assert.doesNotMatch(migration, new RegExp(`\\(${excluded}, '`), `model ${excluded} must stay unweighted`);
  }
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
});
