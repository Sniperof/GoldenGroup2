import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDailyWorkSalesFileQuery } from './dailyWorkSalesFileReport.js';
import { findTabularReport, columnsForGrantedScope } from './tabularReportCatalog.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 42 };
const BRANCH_ACCESS = { scope: 'BRANCH' as const, grantedScope: 'BRANCH' as const, branchIds: [3, 7], userId: 42 };
const ASSIGNED_ACCESS = { scope: 'ASSIGNED' as const, grantedScope: 'ASSIGNED' as const, branchIds: [3], userId: 42 };
const RANGE = { fromDate: '2026-08-01', toDate: '2026-08-31' };

test('contract stays the single row grain with no aggregation over the 1:1 device link', () => {
  const { sql } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /FROM contracts contract/);
  assert.match(sql, /LEFT JOIN installed_devices device ON device\.contract_id = contract\.id/);
  assert.doesNotMatch(sql, /GROUP BY contract\.id/);
  assert.doesNotMatch(sql, /MAX\(device\./);
});

test('the primary date range is mandatory and guarded against a malformed stored value', () => {
  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, {}, { limit: 100 }),
    /مدى تاريخ العقد مطلوب/,
  );
  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { fromDate: '2026-08-31', toDate: '2026-08-01' }, { limit: 100 }),
    /يجب ألا تكون بعد نهايته/,
  );
  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { fromDate: '31-08-2026', toDate: '2026-08-31' }, { limit: 100 }),
    /غير صالح/,
  );
  const { sql, params } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /contract\.contract_date ~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$'/);
  assert.match(sql, /contract\.contract_date >= \$1[\s\S]*contract\.contract_date <= \$2/);
  assert.deepEqual(params, ['2026-08-01', '2026-08-31', 100]);
});

test('every one-to-many source is collapsed in a lateral before it reaches the row', () => {
  const { sql } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  for (const source of [
    /LEFT JOIN LATERAL \([\s\S]*FROM financial_movements movement[\s\S]*\) money ON TRUE/,
    /LEFT JOIN LATERAL \([\s\S]*FROM contract_payment_entries entry[\s\S]*\) payment_methods ON TRUE/,
    /LEFT JOIN LATERAL \([\s\S]*FROM contract_installments installment[\s\S]*\) installments ON TRUE/,
    /LEFT JOIN LATERAL \([\s\S]*FROM gift_records record[\s\S]*\) gift ON TRUE/,
    /LEFT JOIN LATERAL \([\s\S]*FROM client_assignments assignment[\s\S]*\) other_owners ON TRUE/,
    /LEFT JOIN LATERAL \([\s\S]*\) installation ON TRUE/,
  ]) assert.match(sql, source);
});

test('collected and remaining money read the ledger only, never a form field', () => {
  const { sql } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /SUM\(movement\.amount_syp\) FILTER \(WHERE movement\.kind = 'payment'\)/);
  assert.match(sql, /FILTER \(WHERE movement\.kind IN \('charge', 'refund'\)\)[\s\S]*FILTER \(WHERE movement\.kind IN \('payment', 'discount'\)\)/);
  assert.doesNotMatch(sql, /contract\.down_payment/);
  assert.doesNotMatch(sql, /contract\.installments_count/);
});

test('contract money counts the obligations of the contract itself, not the task debts booked on it', () => {
  const { sql } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  const sources = /movement\.source_type IN \('contract', 'contract_installment', 'contract_payment'\)/g;
  // Once for the aggregate and once for the first-payment pick.
  assert.equal(sql.match(sources)?.length, 2);
  assert.match(sql, /FROM financial_movements movement\s*\n\s*WHERE movement\.contract_id = contract\.id\s*\n\s*AND movement\.source_type IN/);
  assert.match(sql, /movement\.kind = 'payment'\s*\n\s*AND movement\.source_type IN/);
  // A positive allowlist, so a task-money source added later cannot leak in silently.
  assert.doesNotMatch(sql, /source_type NOT IN/);
  for (const taskSource of ['periodic_maintenance', 'emergency_maintenance', 'installation', 'golden_warranty', 'opening_balance']) {
    assert.doesNotMatch(sql, new RegExp("'" + taskSource + "'"), taskSource + ' must not feed contract money');
  }
});

test('the sale visit team is reached through the sale reference, not the empty source visit column', () => {
  const { sql } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /demo\.sale_reference_number = contract\.sale_reference_number/);
  assert.match(sql, /NULLIF\(BTRIM\(contract\.sale_reference_number\), ''\) IS NOT NULL/);
  assert.doesNotMatch(sql, /contract\.source_visit_id/);
});

test('visit teams resolve to the effective member after reassignment', () => {
  const { sql } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /COALESCE\(visit\.reassigned_technician_id, NULLIF\(visit\.team_snapshot->>'technicianEmployeeId', ''\)::int\)/);
  assert.match(sql, /COALESCE\(visit\.reassigned_supervisor_id, NULLIF\(visit\.team_snapshot->>'supervisorEmployeeId', ''\)::int\)/);
});

test('the installation row is picked by a defined event time with a unique tie breaker', () => {
  const { sql } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /installation_task\.task_type = 'device_installation'/);
  assert.match(sql, /ORDER BY installation_result\.closed_at DESC NULLS LAST, installation_visit_task\.id DESC\s*\n\s*LIMIT 1/);
});

test('mediator phone resolution splits the two identity paths instead of one OR scan', () => {
  const { sql } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /FROM clients referrer_client[\s\S]*UNION ALL[\s\S]*FROM employees referrer_employee/);
  assert.match(sql, /mediator\.type = 'Client'/);
  assert.match(sql, /mediator\.type = 'Employee'/);
});

test('the other client owners column excludes the seller already shown in its own column', () => {
  const { sql } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /owner\.employee_id IS DISTINCT FROM contract\.sale_owner_id/);
  assert.match(sql, /client\.candidate_status IN \('OP', 'FOP'\) THEN 'ملكية الفرع' ELSE 'بلا مالك'/);
});

test('branch scope is applied to the subject before any detail join', () => {
  const { sql, params } = buildDailyWorkSalesFileQuery(BRANCH_ACCESS, RANGE, { limit: 50 });
  assert.match(sql, /contract\.branch_id = ANY\(\$1::int\[\]\)/);
  assert.deepEqual(params[0], [3, 7]);
});

test('assigned scope binds the row to the sale owner through the acting user account', () => {
  const { sql, params } = buildDailyWorkSalesFileQuery(ASSIGNED_ACCESS, RANGE, { limit: 50 });
  assert.match(sql, /FROM hr_users scoped_user[\s\S]*scoped_user\.employee_id = contract\.sale_owner_id/);
  assert.equal(params[1], 42);
});

test('an unknown contract status is rejected instead of widening the result', () => {
  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { ...RANGE, contractStatus: 'archived' }, { limit: 100 }),
    /حالة العقد غير صالحة/,
  );
  const { sql, params } = buildDailyWorkSalesFileQuery(
    GLOBAL_ACCESS, { ...RANGE, contractStatus: 'discarded' }, { limit: 100 },
  );
  assert.match(sql, /contract\.status = \$3/);
  assert.equal(params[2], 'discarded');
});

test('seller, department and payment filters bind to their own defined columns', () => {
  const { sql, params } = buildDailyWorkSalesFileQuery(
    GLOBAL_ACCESS,
    { ...RANGE, sellerEmployeeId: '88', sellerDepartmentTypeId: '36', paymentType: 'installment' },
    { limit: 100 },
  );
  assert.match(sql, /contract\.sale_owner_id = \$3/);
  assert.match(sql, /department\.department_type_id = \$4/);
  assert.match(sql, /contract\.payment_type = \$5/);
  assert.deepEqual(params.slice(2, 5), [88, 36, 'installment']);
  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { ...RANGE, paymentType: 'barter' }, { limit: 100 }),
    /طريقة الدفع غير صالحة/,
  );
});

test('execution stage is read by stage precedence, never by date order', () => {
  const { sql, params } = buildDailyWorkSalesFileQuery(
    GLOBAL_ACCESS, { ...RANGE, executionStage: 'delivered' }, { limit: 100 },
  );
  assert.match(sql, /WHEN device\.activated_at IS NOT NULL THEN 'activated'[\s\S]*WHEN device\.installation_date IS NOT NULL THEN 'installed'[\s\S]*WHEN device\.delivery_date IS NOT NULL THEN 'delivered'[\s\S]*ELSE 'pending_delivery'/);
  assert.match(sql, /\) = \$3/);
  assert.equal(params[2], 'delivered');
  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { ...RANGE, executionStage: 'cancelled' }, { limit: 100 }),
    /مرحلة التنفيذ غير صالحة/,
  );
});

test('every filter of both groups combines into one narrowed statement', () => {
  const { sql, params } = buildDailyWorkSalesFileQuery(
    BRANCH_ACCESS,
    {
      ...RANGE, sellerEmployeeId: '88', sellerDepartmentTypeId: '36', paymentType: 'cash',
      executionStage: 'activated', contractStatus: 'active', saleType: 'direct',
      saleSubtype: 'definitive', remainingBalance: 'with_remaining', deviceModel: 'catalog:14',
      contractId: '57', geoIds: '11,12',
    },
    { limit: 100 },
  );
  for (const predicate of [
    /contract\.branch_id = ANY/, /contract\.status = /, /contract\.sale_owner_id = /,
    /department\.department_type_id = /, /contract\.payment_type = /, /geo\.unit_ids && /,
    /contract\.sale_type = /, /contract\.sale_subtype = /,
    /COALESCE\(money\.remaining_balance, 0\) > 0/,
    /COALESCE\(device\.device_model_id, contract\.device_model_id\) = /, /contract\.id = /,
  ]) assert.match(sql, predicate);
  // branch + range(2) + status + seller + department + payment + stage + geo + type + subtype + model + sale + limit
  assert.equal(params.length, 14);
});

test('the sale type and subtype filters accept only their CHECK-guarded values', () => {
  const { sql, params } = buildDailyWorkSalesFileQuery(
    GLOBAL_ACCESS, { ...RANGE, saleType: 'tradein', saleSubtype: 'definitive' }, { limit: 100 },
  );
  assert.match(sql, /contract\.sale_type = \$3/);
  assert.match(sql, /contract\.sale_subtype = \$4/);
  assert.deepEqual(params.slice(2, 4), ['tradein', 'definitive']);
  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { ...RANGE, saleType: 'marketing' }, { limit: 100 }),
    /نوع البيعة غير صالح/,
  );
  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { ...RANGE, saleSubtype: 'trial' }, { limit: 100 }),
    /صفة البيعة غير صالحة/,
  );
});

test('a remaining balance means a positive ledger balance only, and a negative one counts as settled', () => {
  const withRemaining = buildDailyWorkSalesFileQuery(
    GLOBAL_ACCESS, { ...RANGE, remainingBalance: 'with_remaining' }, { limit: 100 },
  );
  assert.match(withRemaining.sql, /COALESCE\(money\.remaining_balance, 0\) > 0/);
  // The mode is a closed allowlist, so it never becomes a bound parameter.
  assert.deepEqual(withRemaining.params, ['2026-08-01', '2026-08-31', 100]);

  const settled = buildDailyWorkSalesFileQuery(
    GLOBAL_ACCESS, { ...RANGE, remainingBalance: 'settled' }, { limit: 100 },
  );
  assert.match(settled.sql, /COALESCE\(money\.remaining_balance, 0\) <= 0/);
  assert.doesNotMatch(settled.sql, /remaining_balance <> 0/);

  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { ...RANGE, remainingBalance: 'negative' }, { limit: 100 }),
    /فلتر المتبقي المالي غير صالحة/,
  );
});

test('the device model filter covers the catalog model and the free-text device alike', () => {
  const catalog = buildDailyWorkSalesFileQuery(
    GLOBAL_ACCESS, { ...RANGE, deviceModel: 'catalog:14' }, { limit: 100 },
  );
  assert.match(catalog.sql, /COALESCE\(device\.device_model_id, contract\.device_model_id\) = \$3/);
  assert.equal(catalog.params[2], 14);

  const byId = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { ...RANGE, deviceModelId: '14' }, { limit: 100 });
  assert.equal(byId.params[2], 14);

  const external = buildDailyWorkSalesFileQuery(
    GLOBAL_ACCESS, { ...RANGE, deviceModel: 'external:جهاز مورد خارجي' }, { limit: 100 },
  );
  assert.match(external.sql, /COALESCE\(device\.device_model_id, contract\.device_model_id\) IS NULL AND COALESCE\(NULLIF\(BTRIM\(model\.name_ar\)/);
  assert.equal(external.params[2], 'جهاز مورد خارجي');

  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { ...RANGE, deviceModel: 'مضخة' }, { limit: 100 }),
    /نوع الجهاز غير صالح/,
  );
});

test('the specific-sale filter takes a row identifier and never free text', () => {
  const { sql, params } = buildDailyWorkSalesFileQuery(
    GLOBAL_ACCESS, { ...RANGE, contractId: '57' }, { limit: 100 },
  );
  assert.match(sql, /contract\.id = \$3/);
  assert.equal(params[2], 57);
  // The picked identifier is still subject to the scope predicates, never a bypass of them.
  const scoped = buildDailyWorkSalesFileQuery(BRANCH_ACCESS, { ...RANGE, contractId: '57' }, { limit: 100 });
  assert.match(scoped.sql, /contract\.branch_id = ANY\(\$1::int\[\]\)[\s\S]*contract\.id = \$4/);
  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { ...RANGE, contractId: 'أحمد' }, { limit: 100 }),
    /البيعة المحددة غير صالحة/,
  );
});

test('no filter of this report reaches SQL as a text pattern match', () => {
  const { sql } = buildDailyWorkSalesFileQuery(
    GLOBAL_ACCESS,
    {
      ...RANGE, contractStatus: 'active', sellerEmployeeId: '88', sellerDepartmentTypeId: '36',
      paymentType: 'cash', executionStage: 'activated', saleType: 'direct', saleSubtype: 'definitive',
      remainingBalance: 'with_remaining', deviceModel: 'catalog:14', contractId: '57', geoIds: '11',
    },
    { limit: 100 },
  );
  assert.doesNotMatch(sql, /ILIKE/);
  assert.doesNotMatch(sql, /LIKE/);
  assert.doesNotMatch(sql, /to_tsquery/i);
});

test('geography matches the selected node or any of its ancestors', () => {
  const { sql, params } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { ...RANGE, geoIds: '11,12' }, { limit: 100 });
  assert.match(sql, /geo\.unit_ids && \$3::int\[\]/);
  assert.deepEqual(params[2], [11, 12]);
});

test('ordering is total and ends with a unique tie breaker so snapshot batches stay stable', () => {
  const { sql } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  assert.match(sql, /ORDER BY contract\.contract_date DESC NULLS LAST, contract\.id DESC/);
  const sorted = buildDailyWorkSalesFileQuery(
    GLOBAL_ACCESS, { ...RANGE, sortKey: 'sellerName', sortDir: 'desc' }, { limit: 100 },
  );
  assert.match(sorted.sql, /ORDER BY "sellerName" DESC NULLS LAST, contract\.contract_date DESC NULLS LAST, contract\.id DESC/);
  assert.throws(
    () => buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, { ...RANGE, sortKey: 'contractNotes' }, { limit: 100 }),
    /غير متاح للفرز/,
  );
});

test('the snapshot path drops the per-row total count', () => {
  const withCount = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100 });
  const withoutCount = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100, includeTotalRows: false });
  assert.match(withCount.sql, /COUNT\(\*\) OVER\(\)::int AS "totalRows"/);
  assert.doesNotMatch(withoutCount.sql, /COUNT\(\*\) OVER\(\)/);
});

test('the catalog entry declares the group, scopes and branch column contract', () => {
  const definition = findTabularReport('daily_work.sales_file');
  assert.ok(definition);
  assert.equal(definition.groupKey, 'daily_work');
  assert.equal(definition.filters.dateRange, 'required');
  assert.equal(definition.filters.contractStatus, true);
  for (const flag of ['contractSaleType', 'contractSaleSubtype', 'contractRemainingBalance', 'deviceModel', 'contractSale'] as const) {
    assert.equal(definition.filters[flag], true, 'filter flag ' + flag + ' must be declared');
  }
  // §9.7.5: this report offers selection filters only — it declares no free-text entry field.
  assert.notEqual(definition.filters.search, true);
  assert.notEqual(definition.filters.candidateNameSearch, true);
  assert.notEqual(definition.filters.mediatorName, true);
  assert.notEqual(definition.filters.occupation, true);
  assert.deepEqual(definition.supportedScopes, ['GLOBAL', 'BRANCH', 'ASSIGNED']);

  const globalColumns = columnsForGrantedScope(definition, 'GLOBAL');
  const branchColumns = columnsForGrantedScope(definition, 'BRANCH');
  assert.equal(globalColumns[0].key, 'branchName');
  assert.equal(globalColumns.length, branchColumns.length + 1);
  assert.equal(branchColumns.some(column => column.key === 'branchName'), false);

  for (const column of globalColumns) {
    assert.ok(definition.guide.columnDescriptions[column.key], `missing guide text for ${column.key}`);
  }
  for (const key of ['contractNotes', 'installationAddress', 'primaryContactNumber', 'mediatorContactNumber']) {
    assert.equal(branchColumns.find(column => column.key === key)?.sortable, false, `${key} must stay unsortable`);
  }
});

test('every selected column key exists in the catalog and nothing extra leaks', () => {
  const definition = findTabularReport('daily_work.sales_file');
  assert.ok(definition);
  const { sql } = buildDailyWorkSalesFileQuery(GLOBAL_ACCESS, RANGE, { limit: 100, includeTotalRows: false });
  const selected = new Set(Array.from(sql.matchAll(/AS "([A-Za-z]+)"/g), match => match[1]));
  for (const column of columnsForGrantedScope(definition, 'GLOBAL')) {
    assert.equal(selected.has(column.key), true, `column ${column.key} is not selected by the query`);
  }
  selected.delete('branchId');
  assert.equal(selected.size, columnsForGrantedScope(definition, 'GLOBAL').length);
});

test('permission migration keeps view and export independent across all supported scopes', () => {
  const migration = readFileSync('migrations/449_daily_work_sales_file_report.sql', 'utf8');
  assert.match(migration, /reports\.daily_work\.sales_file\.view/);
  assert.match(migration, /reports\.daily_work\.sales_file\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]::text\[\]/);
  // The baseline grant derives from contract visibility and never auto-grants export.
  assert.match(migration, /permission\.key = 'contracts\.view_list'/);
  assert.doesNotMatch(migration, /report_permission[\s\S]*sales_file\.export[\s\S]*INSERT INTO public\.role_permission_grants/);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
});
