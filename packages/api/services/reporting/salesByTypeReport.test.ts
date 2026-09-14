import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSalesByTypeQuery, parseDeviceModelIds } from './salesByTypeReport.js';
import { findTabularReport, columnsForGrantedScope } from './tabularReportCatalog.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 42 };
const BRANCH_ACCESS = { scope: 'BRANCH' as const, grantedScope: 'BRANCH' as const, branchIds: [3, 7], userId: 42 };
const RANGE = { fromDate: '2026-08-01', toDate: '2026-08-31' };

test('the branch is the row grain and each population is collapsed in its own lateral', () => {
  const { sql } = buildSalesByTypeQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /FROM branches branch/);
  assert.match(sql, /LEFT JOIN LATERAL \([\s\S]*FROM contracts contract[\s\S]*\) contracts ON TRUE/);
  assert.match(sql, /LEFT JOIN LATERAL \([\s\S]*FROM visit_task_device_demo_results demo[\s\S]*\) offers ON TRUE/);
  // The two populations never meet in one join, so neither multiplies the other.
  assert.doesNotMatch(sql, /JOIN contracts contract[\s\S]*JOIN visit_task_device_demo_results/);
  assert.doesNotMatch(sql, /GROUP BY branch\.id/);
});

test('the period is mandatory, ordered, and guarded against a malformed stored date', () => {
  assert.throws(() => buildSalesByTypeQuery(GLOBAL_ACCESS, {}, { limit: 100 }), /مدة التقرير مطلوبة/);
  assert.throws(
    () => buildSalesByTypeQuery(GLOBAL_ACCESS, { fromDate: '2026-08-31', toDate: '2026-08-01' }, { limit: 100 }),
    /يجب ألا تكون بعد نهايتها/,
  );
  assert.throws(
    () => buildSalesByTypeQuery(GLOBAL_ACCESS, { fromDate: '01-08-2026', toDate: '2026-08-31' }, { limit: 100 }),
    /غير صالح/,
  );
  const { sql } = buildSalesByTypeQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /contract\.contract_date ~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$'/);
  // Contracts are dated by the contract, offers by the moment their result closed.
  assert.match(sql, /contract\.contract_date >= \$1[\s\S]*contract\.contract_date <= \$2/);
  assert.match(sql, /\(result\.closed_at AT TIME ZONE 'Asia\/Damascus'\)::date >= \$1::date/);
});

test('every rate stays inside the offer population and never divides by zero', () => {
  const { sql } = buildSalesByTypeQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  for (const rate of [
    /CASE WHEN COALESCE\(offers\.marketing_offers, 0\) > 0\s*\n\s*THEN ROUND\(offers\.marketing_sales \* 100\.0 \/ offers\.marketing_offers, 1\) END AS "marketingCloseRate"/,
    /CASE WHEN COALESCE\(offers\.instant_offers, 0\) > 0\s*\n\s*THEN ROUND\(offers\.instant_sales \* 100\.0 \/ offers\.instant_offers, 1\) END AS "instantCloseRate"/,
    /CASE WHEN COALESCE\(offers\.total_offers, 0\) > 0\s*\n\s*THEN ROUND\(offers\.total_offer_sales \* 100\.0 \/ offers\.total_offers, 1\) END AS "overallCloseRate"/,
  ]) assert.match(sql, rate);
  // A rate's numerator is never the contract population, so it cannot exceed 100%.
  assert.doesNotMatch(sql, /contracts\.[a-z_]+ \* 100\.0/);
});

test('an offer counts as sold by the contract behind it, not by the is_device_sold flag', () => {
  const { sql } = buildSalesByTypeQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /EXISTS \(\s*\n\s*SELECT 1 FROM contracts offer_contract/);
  assert.match(sql, /offer_contract\.id = demo\.contract_id/);
  assert.match(sql, /offer_contract\.sale_reference_number = demo\.sale_reference_number/);
  assert.doesNotMatch(sql, /is_device_sold/);
});

test('both populations agree on what a sale is: active and completed only', () => {
  const { sql } = buildSalesByTypeQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.equal(sql.match(/status IN \('active', 'completed'\)/g)?.length, 2);
  assert.match(sql, /contract\.status IN \('active', 'completed'\)/);
  assert.match(sql, /offer_contract\.status IN \('active', 'completed'\)/);
});

test('the two channels are read from the visit origin, never from the free-text sale source', () => {
  const { sql } = buildSalesByTypeQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /FILTER \(WHERE visit\.origin_type = 'telemarketing'\)::int AS marketing_offers/);
  assert.match(sql, /FILTER \(WHERE visit\.origin_type = 'field_initiated'\)::int AS instant_offers/);
  // No filter on the task type: an offer counts wherever it was recorded (DEC-D).
  assert.doesNotMatch(sql, /task\.task_type/);
  assert.doesNotMatch(sql, /visit\.visit_type/);
  // The social-media column is the only one on sale_source, and it is parameterized.
  assert.match(sql, /FILTER \(WHERE BTRIM\(contract\.sale_source\) = \$3\)::int AS social_media_sales/);
});

test('branch scope is applied to the subject, and a closed branch shows only when it traded', () => {
  const scoped = buildSalesByTypeQuery(BRANCH_ACCESS, RANGE, { limit: 100 });
  assert.match(scoped.sql, /branch\.id = ANY\(\$1::int\[\]\)/);
  assert.deepEqual(scoped.params[0], [3, 7]);
  assert.match(scoped.sql, /branch\.status = 'active'\s*\n\s*OR COALESCE\(contracts\.trade_in_sales, 0\)/);
});

test('the sale subtype filter binds to its own column and rejects an unknown value', () => {
  const { sql, params } = buildSalesByTypeQuery(
    GLOBAL_ACCESS, { ...RANGE, saleSubtype: 'definitive' }, { limit: 100 },
  );
  assert.match(sql, /contract\.sale_subtype = \$4/);
  assert.equal(params[3], 'definitive');
  assert.throws(
    () => buildSalesByTypeQuery(GLOBAL_ACCESS, { ...RANGE, saleSubtype: 'trial' }, { limit: 100 }),
    /صفة البيعة غير صالحة/,
  );
});

test('device selection adds one column per model plus their total, keyed by id', () => {
  const none = buildSalesByTypeQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.doesNotMatch(none.sql, /deviceModel_/);
  assert.doesNotMatch(none.sql, /selectedDevicesTotal/);

  const picked = buildSalesByTypeQuery(
    GLOBAL_ACCESS, { ...RANGE, deviceModelIds: '1195,2462' }, { limit: 100 },
  );
  assert.match(picked.sql, /AS "deviceModel_1195"/);
  assert.match(picked.sql, /AS "deviceModel_2462"/);
  assert.match(picked.sql, /AS "selectedDevicesTotal"/);
  assert.match(picked.sql, /COALESCE\(device\.device_model_id, contract\.device_model_id\) = 1195/);
  assert.deepEqual(picked.params[3], [1195, 2462]);
});

test('a selected device that is not a positive id is rejected instead of ignored', () => {
  assert.deepEqual(parseDeviceModelIds({ deviceModelIds: '4, 9 ,4' }), [4, 9]);
  assert.deepEqual(parseDeviceModelIds({}), []);
  assert.throws(() => parseDeviceModelIds({ deviceModelIds: 'تشالنجر' }), /أحد الأجهزة المختارة غير صالح/);
  assert.throws(() => parseDeviceModelIds({ deviceModelIds: '5,-1' }), /أحد الأجهزة المختارة غير صالح/);
});

test('ordering is total and ends with a unique tie breaker so snapshot batches stay stable', () => {
  const { sql } = buildSalesByTypeQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /ORDER BY COALESCE\(contracts\.trade_in_sales, 0\)[\s\S]*branch\.id ASC/);
  const sorted = buildSalesByTypeQuery(
    GLOBAL_ACCESS, { ...RANGE, sortKey: 'marketingOffers', sortDir: 'desc' }, { limit: 100 },
  );
  assert.match(sorted.sql, /ORDER BY "marketingOffers" DESC NULLS LAST/);
  assert.throws(
    () => buildSalesByTypeQuery(GLOBAL_ACCESS, { ...RANGE, sortKey: 'socialMedia' }, { limit: 100 }),
    /غير متاح للفرز/,
  );
});

test('the snapshot path drops the per-row total count', () => {
  const withCount = buildSalesByTypeQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  const withoutCount = buildSalesByTypeQuery(GLOBAL_ACCESS, RANGE, { limit: 100, includeTotalRows: false });
  assert.match(withCount.sql, /COUNT\(\*\) OVER\(\)::int AS "totalRows"/);
  assert.doesNotMatch(withoutCount.sql, /COUNT\(\*\) OVER\(\)/);
});

test('the catalog declares a branch-grained report with no assigned scope and no duplicate branch column', () => {
  const definition = findTabularReport('performance.sales_by_type');
  assert.ok(definition);
  assert.equal(definition.groupKey, 'daily_work');
  assert.equal(definition.filters.dateRange, 'required');
  assert.equal(definition.rowIsBranch, true);
  assert.deepEqual(definition.supportedScopes, ['GLOBAL', 'BRANCH']);
  assert.equal(definition.supportedScopes?.includes('ASSIGNED' as never), false);

  // The branch is the row identity, so the shared GLOBAL column is not injected.
  const globalColumns = columnsForGrantedScope(definition, 'GLOBAL');
  const branchColumns = columnsForGrantedScope(definition, 'BRANCH');
  assert.equal(globalColumns.length, branchColumns.length);
  assert.equal(globalColumns.filter(column => column.key === 'branchName').length, 1);
  assert.equal(branchColumns[0].key, 'branchName');

  for (const column of globalColumns) {
    assert.ok(definition.guide.columnDescriptions[column.key], `missing guide text for ${column.key}`);
  }
  // Selection-only columns still need their guide entry before they can be rendered.
  assert.ok(definition.guide.columnDescriptions.selectedDevicesTotal);
});

test('every catalog column is selected by the query and nothing extra leaks', () => {
  const definition = findTabularReport('performance.sales_by_type');
  assert.ok(definition);
  const { sql } = buildSalesByTypeQuery(GLOBAL_ACCESS, RANGE, { limit: 100, includeTotalRows: false });
  const selected = new Set(Array.from(sql.matchAll(/AS "([A-Za-z]+)"/g), match => match[1]));
  for (const column of columnsForGrantedScope(definition, 'GLOBAL')) {
    assert.equal(selected.has(column.key), true, `column ${column.key} is not selected by the query`);
  }
  selected.delete('branchId');
  assert.equal(selected.size, columnsForGrantedScope(definition, 'GLOBAL').length);
});

test('the permission migration keeps view and export independent and skips the unsupported scope', () => {
  const migration = readFileSync('migrations/450_sales_by_type_report.sql', 'utf8');
  assert.match(migration, /reports\.performance\.sales_by_type\.view/);
  assert.match(migration, /reports\.performance\.sales_by_type\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH'\]::text\[\]/);
  assert.doesNotMatch(migration, /ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]/);
  // The baseline derives from contract visibility, never auto-grants export, and
  // copies no ASSIGNED grant because the report declares no ASSIGNED scope.
  assert.match(migration, /permission\.key = 'contracts\.view_list'/);
  assert.match(migration, /grant_row\.scope_type IN \('GLOBAL', 'BRANCH'\)/);
  assert.doesNotMatch(migration, /sales_by_type\.export'\s*\)[\s\S]*INSERT INTO public\.role_permission_grants/);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
});
