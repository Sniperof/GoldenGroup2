import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SALES_COUNT_MAX_DEVICE_MODELS,
  buildSalesCountQuery,
  parseSalesCountDeviceModelIds,
} from './salesCountReport.js';
import {
  columnsForGrantedScope,
  findTabularReport,
  mergeTabularReportColumns,
} from './tabularReportCatalog.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 42 };
const BRANCH_ACCESS = { scope: 'BRANCH' as const, grantedScope: 'BRANCH' as const, branchIds: [3, 7], userId: 42 };
const ASSIGNED_ACCESS = { scope: 'ASSIGNED' as const, grantedScope: 'ASSIGNED' as const, branchIds: [3], userId: 42 };
const RANGE = { fromDate: '2026-08-01', toDate: '2026-08-31', deviceModelIds: '11,12' };

test('the row is a seller inside a branch, and unowned sales collect instead of dropping', () => {
  const { sql } = buildSalesCountQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /GROUP BY contract\.branch_id, contract\.sale_owner_id/);
  assert.match(sql, /'غير منسوب إلى بائع'/);
  // The grain is the group key itself, so no join can multiply it.
  assert.match(sql, /COUNT\(\*\)::int AS "totalSales"/);
});

test('the installed device is reduced to one row before it reaches the grain', () => {
  const { sql } = buildSalesCountQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /LEFT JOIN LATERAL \(\s*\n\s*SELECT installed\.device_model_id/);
  assert.match(sql, /ORDER BY installed\.id ASC\s*\n\s*LIMIT 1\s*\n\s*\) device ON TRUE/);
  assert.doesNotMatch(sql, /JOIN installed_devices installed ON/);
});

test('a sale is a definitive active or completed contract, read behind the varchar date guard', () => {
  const { sql } = buildSalesCountQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /contract\.status IN \('active', 'completed'\)/);
  assert.match(sql, /contract\.sale_subtype = 'definitive'/);
  assert.match(sql, /contract\.contract_date ~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$'/);
  // The date column is varchar, so both bounds compare as text and never as a date.
  assert.match(sql, /contract\.contract_date >= \$\d+::text/);
  assert.match(sql, /contract\.contract_date <= \$\d+::text/);
});

test('the device picker is mandatory, capped, and validated before it reaches SQL', () => {
  assert.throws(
    () => buildSalesCountQuery(GLOBAL_ACCESS, { fromDate: '2026-08-01', toDate: '2026-08-31' }, { limit: 100 }),
    /اختر جهازًا واحدًا على الأقل/,
  );
  const tooMany = Array.from({ length: SALES_COUNT_MAX_DEVICE_MODELS + 1 }, (_, index) => index + 1).join(',');
  assert.throws(
    () => parseSalesCountDeviceModelIds({ deviceModelIds: tooMany }),
    new RegExp(`أكثر من ${SALES_COUNT_MAX_DEVICE_MODELS}`),
  );
  assert.throws(() => parseSalesCountDeviceModelIds({ deviceModelIds: 'abc' }), /أحد الأجهزة المختارة غير صالح/);
  assert.deepEqual(parseSalesCountDeviceModelIds({ deviceModelIds: '4, 9 ,4' }), [4, 9]);
});

test('the selection filters the population, so the totals and the columns close on each other', () => {
  const { sql, params } = buildSalesCountQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  const modelsIndex = params.findIndex(value => Array.isArray(value) && value.length === 2 && value[0] === 11);
  assert.ok(modelsIndex >= 0, 'the selected models are bound as a parameter array');
  assert.match(sql, new RegExp(`= ANY\\(\\$${modelsIndex + 1}::int\\[\\]\\)`));
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE COALESCE\(device\.device_model_id, contract\.device_model_id\) = 11\)::int AS "deviceModel_11"/);
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE COALESCE\(device\.device_model_id, contract\.device_model_id\) = 12\)::int AS "deviceModel_12"/);
});

test('points come from the stored model weight, and a weightless model still counts its sale', () => {
  const { sql } = buildSalesCountQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /COALESCE\(SUM\(model\.sale_points\), 0\)::numeric AS "salesPoints"/);
  // The model join is a LEFT JOIN, so an unweighted model keeps its row in COUNT(*).
  assert.match(sql, /LEFT JOIN device_models model ON model\.id = /);
  assert.doesNotMatch(sql, /COALESCE\(model\.sale_points, 1\)/);
});

test('the period is mandatory and ordered', () => {
  assert.throws(
    () => buildSalesCountQuery(GLOBAL_ACCESS, { deviceModelIds: '11' }, { limit: 100 }),
    /مدة التقرير مطلوبة/,
  );
  assert.throws(
    () => buildSalesCountQuery(GLOBAL_ACCESS, { ...RANGE, fromDate: '2026-08-31', toDate: '2026-08-01' }, { limit: 100 }),
    /يجب ألا تكون بعد نهايتها/,
  );
  assert.throws(
    () => buildSalesCountQuery(GLOBAL_ACCESS, { ...RANGE, fromDate: '31-08-2026' }, { limit: 100 }),
    /بداية المدة غير صالح/,
  );
});

test('scope is applied on the server for every supported mode', () => {
  const globalSql = buildSalesCountQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.doesNotMatch(globalSql.sql, /contract\.branch_id = ANY/);

  const branchSql = buildSalesCountQuery(BRANCH_ACCESS, RANGE, { limit: 100 });
  assert.match(branchSql.sql, /contract\.branch_id = ANY\(\$\d+::int\[\]\)/);
  assert.ok(branchSql.params.some(value => Array.isArray(value) && value[0] === 3 && value[1] === 7));

  const assignedSql = buildSalesCountQuery(ASSIGNED_ACCESS, RANGE, { limit: 100 });
  assert.match(assignedSql.sql, /FROM hr_users scoped_user\s*\n\s*WHERE scoped_user\.id = \$\d+\s*\n\s*AND scoped_user\.employee_id = contract\.sale_owner_id/);
});

test('the seller and department-type filters narrow the same population', () => {
  const { sql } = buildSalesCountQuery(
    GLOBAL_ACCESS, { ...RANGE, sellerEmployeeId: 1226838, departmentTypeId: 5 }, { limit: 100 },
  );
  assert.match(sql, /AND contract\.sale_owner_id = \$\d+/);
  assert.match(sql, /AND department\.department_type_id = \$\d+/);
});

test('the default order is deterministic and ends on a unique key', () => {
  const { sql } = buildSalesCountQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /ORDER BY "salesPoints" DESC, "totalSales" DESC, contract\.branch_id ASC, contract\.sale_owner_id ASC NULLS LAST/);
  const sorted = buildSalesCountQuery(GLOBAL_ACCESS, { ...RANGE, sortKey: 'totalSales', sortDir: 'desc' }, { limit: 100 });
  assert.match(sorted.sql, /ORDER BY "totalSales" DESC NULLS LAST, "salesPoints" DESC/);
  assert.throws(
    () => buildSalesCountQuery(GLOBAL_ACCESS, { ...RANGE, sortKey: 'sale_owner_id' }, { limit: 100 }),
    /غير متاح للفرز/,
  );
});

test('the catalog declares the report, its scopes, and the mandatory picker', () => {
  const definition = findTabularReport('performance.sales_count');
  assert.ok(definition);
  assert.deepEqual(definition.supportedScopes, ['GLOBAL', 'BRANCH', 'ASSIGNED']);
  assert.equal(definition.filters.reportDeviceModels, true);
  assert.equal(definition.filters.reportDeviceModelsRequired, true);
  assert.equal(definition.filters.dateRange, 'required');
  assert.equal(definition.rowIsBranch, true);
  assert.deepEqual(definition.columns.map(column => column.key), [
    'branchName', 'sellerName', 'jobTitle', 'departmentName', 'totalSales', 'salesPoints',
  ]);
  // The branch is the row's identity here, so GLOBAL must not inject a second one.
  const globalColumns = columnsForGrantedScope(definition, 'GLOBAL');
  assert.equal(globalColumns.filter(column => column.key === 'branchName').length, 1);
  assert.equal(definition.dynamicColumnsBeforeKey, 'totalSales');
});

test('the device columns land before the totals, so the points column stays last', () => {
  const definition = findTabularReport('performance.sales_count');
  assert.ok(definition);
  const fixed = columnsForGrantedScope(definition, 'GLOBAL');
  const dynamic = [
    { key: 'deviceModel_11', titleAr: 'بيعات أ', type: 'integer' as const, width: 20, sortable: true },
    { key: 'deviceModel_12', titleAr: 'بيعات ب', type: 'integer' as const, width: 20, sortable: true },
  ];
  const merged = mergeTabularReportColumns(fixed, dynamic, definition.dynamicColumnsBeforeKey);
  assert.deepEqual(merged.map(column => column.key), [
    'branchName', 'sellerName', 'jobTitle', 'departmentName',
    'deviceModel_11', 'deviceModel_12', 'totalSales', 'salesPoints',
  ]);
  // The totals stay catalogue columns, so they remain sortable on the server.
  assert.doesNotThrow(() => buildSalesCountQuery(GLOBAL_ACCESS, { ...RANGE, sortKey: 'salesPoints', sortDir: 'desc' }, { limit: 10 }));
});

test('without an anchor the per-run columns still append, so other reports are untouched', () => {
  const fixed = [{ key: 'a', titleAr: 'أ', type: 'text' as const, width: 10 }];
  const dynamic = [{ key: 'b', titleAr: 'ب', type: 'integer' as const, width: 10 }];
  assert.deepEqual(mergeTabularReportColumns(fixed, dynamic).map(column => column.key), ['a', 'b']);
  assert.deepEqual(mergeTabularReportColumns(fixed, dynamic, 'missing').map(column => column.key), ['a', 'b']);
  assert.deepEqual(mergeTabularReportColumns(fixed, [], 'a').map(column => column.key), ['a']);
});

test('every catalog column is selected by the query and every column is documented', () => {
  const definition = findTabularReport('performance.sales_count');
  assert.ok(definition);
  const { sql } = buildSalesCountQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  for (const column of definition.columns) {
    assert.match(sql, new RegExp(`AS "${column.key}"`), `${column.key} must be selected`);
    assert.ok(definition.guide.columnDescriptions[column.key], `${column.key} must be documented`);
  }
});

test('the migration declares both permissions with ASSIGNED and seeds its own title key', () => {
  const migration = readFileSync('migrations/453_sales_count_report.sql', 'utf8');
  assert.match(migration, /reports\.performance\.sales_count\.view/);
  assert.match(migration, /reports\.performance\.sales_count\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]::text\[\]/);
  // Its own metadata key: merging into sellerJobTitles would move the department
  // report's headcount column.
  assert.match(migration, /'saleOwnerJobTitles'/);
  assert.doesNotMatch(migration, /'sellerJobTitles'/);
  assert.match(migration, /jsonb_build_array\('مشرفة', 'فني صيانة'\)/);
  assert.match(migration, /jsonb_build_array\('ديلر', 'مندوب التسويق'\)/);
});
