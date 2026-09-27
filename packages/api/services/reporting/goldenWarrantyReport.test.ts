import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TabularReportAccess } from './tabularReportAccess.js';
import { buildGoldenWarrantyQuery } from './goldenWarrantyReport.js';
import { columnsForGrantedScope, findTabularReport } from './tabularReportCatalog.js';

const globalAccess: TabularReportAccess = {
  scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 11,
};
const branchAccess: TabularReportAccess = {
  scope: 'BRANCH', grantedScope: 'BRANCH', branchIds: [1002], userId: 12,
};

function sqlFor(request: Record<string, unknown> = {}, access = globalAccess) {
  return buildGoldenWarrantyQuery(access, request as never, { limit: 10 });
}

test('the subject is the golden warranty, and its branch gate is applied before the detail joins', () => {
  const { sql, params } = sqlFor({}, branchAccess);

  assert.match(sql, /FROM device_warranties warranty/);
  assert.match(sql, /JOIN installed_devices device ON device\.id = warranty\.device_id/);
  assert.match(sql, /warranty\.warranty_type = 'golden'/);
  assert.match(sql, /device\.branch_id = ANY\(\$1::int\[\]\)/);
  assert.deepEqual(params[0], [1002]);
});

test('ASSIGNED is refused rather than silently narrowed', () => {
  const assigned: TabularReportAccess = {
    scope: 'ASSIGNED', grantedScope: 'ASSIGNED', branchIds: [1002], userId: 13,
  };
  assert.throws(() => sqlFor({}, assigned), /متاح على مستوى كل الفروع أو الفرع فقط/);
});

test('every one-to-many source is reduced to a single row so the warranty grain survives', () => {
  const { sql } = sqlFor();

  // Each detail source is its own LATERAL with its own tie-breaker; none of them
  // joins the warranty row directly, which is what would multiply it.
  for (const lateral of ['geo', 'last_periodic', 'technical_state', 'offer_team', 'booking_call', 'card', 'parts']) {
    assert.match(sql, new RegExp(`LEFT JOIN LATERAL \\([\\s\\S]*?\\) ${lateral} ON TRUE`));
  }
  assert.match(sql, /ORDER BY state\.created_at DESC, state\.id DESC\s*LIMIT 1/);
  assert.match(sql, /ORDER BY offer_visit_task\.id DESC\s*LIMIT 1/);
});

test('the ordering is total, so snapshot row numbers cannot drift between batches', () => {
  const { sql } = sqlFor();
  assert.match(sql, /ORDER BY warranty\.end_date ASC NULLS LAST, warranty\.id ASC/);
});

test('sorting accepts a catalogue column and refuses anything else', () => {
  const { sql } = sqlFor({ sortKey: 'customerName', sortDir: 'desc' });
  assert.match(sql, /ORDER BY "customerName" DESC NULLS LAST, warranty\.end_date ASC NULLS LAST, warranty\.id ASC/);

  assert.throws(() => sqlFor({ sortKey: 'warrantyId', sortDir: 'asc' }), /غير متاح للفرز/);
  assert.throws(() => sqlFor({ sortKey: 'customerName', sortDir: 'sideways' }), /اتجاه فرز/);
});

test('the activation-record column and its filter read the same fact', () => {
  const { sql } = sqlFor();
  assert.match(sql, /CASE WHEN warranty\.offer_task_id IS NOT NULL\s*\n?\s*THEN 'مسجَّل بمهمة عرض'/);

  assert.match(sqlFor({ activationRecord: 'recorded' }).sql, /warranty\.offer_task_id IS NOT NULL/);
  assert.match(sqlFor({ activationRecord: 'unrecorded' }).sql, /warranty\.offer_task_id IS NULL/);
  assert.throws(() => sqlFor({ activationRecord: 'imported' }), /سجل التفعيل غير صالح/);
});

test('«سارية» is derived from the visible end date, not from the stale status column', () => {
  // Measured on the development database: 203 rows carry status = 'active' while
  // only 192 still have a future end_date. Reading the raw column would have called
  // eleven ended warranties «سارية».
  const { sql } = sqlFor({ warrantyStatus: 'active' });
  assert.match(sql, /warranty\.end_date IS NULL OR warranty\.end_date >= CURRENT_DATE THEN 'active'/);
  assert.doesNotMatch(sql, /AND warranty\.status = \$\d+/);
  assert.throws(() => sqlFor({ warrantyStatus: 'lapsed' }), /حالة الكفالة غير صالحة/);
});

test('the start date is shown, never derived from the month count', () => {
  const { sql } = sqlFor();
  assert.match(sql, /TO_CHAR\(warranty\.start_date, 'YYYY-MM-DD'\) AS "warrantyStart"/);
  // DEC-GW-6: the month count of the unrecorded rows was written by a backfill, so
  // deriving a start from it would publish an invented date.
  assert.doesNotMatch(sql, /make_interval/);
});

test('the parts window is closed when no start date was recorded', () => {
  const { sql } = sqlFor();
  assert.match(sql, /WHERE warranty\.start_date IS NOT NULL/);
  assert.match(sql, /BETWEEN warranty\.start_date AND warranty\.end_date/);
  assert.match(sql, /COALESCE\(used\.event_date, source_task\.closed_day\)/);
  assert.match(sql, /used\.event_type = 'replaced'/);
  assert.match(sql, /THEN 'مدة الكفالة غير مسجَّلة'/);
});

test('the parts filter reads the same aggregate the parts column shows', () => {
  assert.match(sqlFor({ warrantyPartsPresence: 'yes' }).sql, /parts\.summary IS NOT NULL/);
  assert.match(sqlFor({ warrantyPartsPresence: 'no' }).sql, /parts\.summary IS NULL/);
  assert.throws(() => sqlFor({ warrantyPartsPresence: 'maybe' }), /قيمة فلتر القطع المبدلة غير صالحة/);
});

test('the contact columns come from the call that booked the offer visit', () => {
  const { sql } = sqlFor();
  assert.match(sql, /FROM call_task_links link/);
  assert.match(sql, /link\.task_id = warranty\.offer_task_id/);
  assert.match(sql, /ORDER BY link\.is_primary DESC, call_log\.call_date DESC NULLS LAST/);
  // DEC-GW-8: not «the newest call to the customer», which pulled in unrelated calls.
  assert.doesNotMatch(sql, /call_log\.customer_id = client\.id/);
});

test('the card columns and their filter read one card task, and «none» is a real answer', () => {
  const { sql } = sqlFor();
  assert.match(sql, /card_task\.id = warranty\.card_delivery_task_id/);
  assert.match(sql, /card_visit_task\.task_type = 'golden_warranty_card_delivery'/);

  assert.match(sqlFor({ cardDeliveryResult: 'none' }).sql, /card\.final_decision IS NULL/);
  assert.match(sqlFor({ cardDeliveryResult: 'delivered' }).sql, /card\.final_decision = \$\d+/);
  assert.throws(() => sqlFor({ cardDeliveryResult: 'lost' }), /نتيجة تسليم الكرت غير صالحة/);
});

test('the team filters read the offer visit, and the scope filter reads the device source', () => {
  assert.match(sqlFor({ supervisorEmployeeId: 5 }).sql, /offer_team\.supervisor_id = \$\d+/);
  assert.match(sqlFor({ technicianEmployeeId: 7 }).sql, /offer_team\.technician_id = \$\d+/);
  assert.match(sqlFor({ contractScope: 'external' }).sql, /device\.device_source = 'external'/);
  assert.match(sqlFor({ contractScope: 'internal' }).sql, /device\.device_source <> 'external'/);
  assert.throws(() => sqlFor({ contractScope: 'mixed' }), /حالة العقد غير صالحة/);
});

test('the date filters are validated and bound, never interpolated', () => {
  const { sql, params } = sqlFor({
    warrantyStartFrom: '2026-01-01', warrantyStartTo: '2026-12-31',
    warrantyEndFrom: '2027-01-01', warrantyEndTo: '2027-12-31',
  });
  assert.match(sql, /warranty\.start_date >= \$\d+::date/);
  assert.match(sql, /warranty\.end_date <= \$\d+::date/);
  assert.ok(params.includes('2026-01-01') && params.includes('2027-12-31'));

  assert.throws(() => sqlFor({ warrantyEndFrom: '31-12-2027' }), /غير صالح/);
  assert.throws(() => sqlFor({ warrantyEndFrom: '2027-12-31', warrantyEndTo: '2027-01-01' }), /يجب ألا تكون بعد نهايته/);
});

test('an unknown device status is refused instead of widening the result', () => {
  assert.match(sqlFor({ deviceStatus: 'active' }).sql, /device\.status = \$\d+/);
  assert.throws(() => sqlFor({ deviceStatus: 'broken' }), /حالة صيانة الجهاز غير صالحة/);
});

test('the catalogue entry carries the agreed contract and every column it selects', () => {
  const definition = findTabularReport('service.golden_warranty');
  assert.ok(definition, 'the report must be registered in the catalogue');
  assert.equal(definition.groupKey, 'service');
  assert.deepEqual(definition.supportedScopes, ['GLOBAL', 'BRANCH']);
  assert.equal(definition.filters.dateRange, 'none');
  assert.equal(definition.rowIsBranch, true);
  assert.equal(definition.columns.length, 24);

  // The branch column is the row's own, so a GLOBAL viewer must not receive a second.
  const globalColumns = columnsForGrantedScope(definition, 'GLOBAL');
  assert.equal(globalColumns.filter(column => column.key === 'branchName').length, 1);

  const { sql } = sqlFor();
  for (const column of definition.columns) {
    assert.match(sql, new RegExp(`AS "${column.key}"`), `column ${column.key} is not selected`);
    assert.ok(definition.guide.columnDescriptions[column.key], `column ${column.key} has no guide text`);
  }
});

test('the migration registers both capabilities at the two supported scopes only', () => {
  const migration = readFileSync('migrations/464_golden_warranty_report.sql', 'utf8');

  assert.match(migration, /reports\.service\.golden_warranty\.view/);
  assert.match(migration, /reports\.service\.golden_warranty\.export/);
  // The migration explains in prose why ASSIGNED is absent, so the assertion reads
  // the declared scope arrays rather than the word appearing anywhere in the file.
  const declaredScopes = migration.match(/ARRAY\[[^\]]*\]::text\[\]/g) ?? [];
  assert.equal(declaredScopes.length, 2);
  for (const scopes of declaredScopes) assert.equal(scopes, "ARRAY['GLOBAL','BRANCH']::text[]");
  // View is seeded from an existing capability; export stays a separate decision.
  assert.match(migration, /permission\.key = 'installed_devices\.view'/);
  assert.doesNotMatch(migration, /report_permission AS \([\s\S]*golden_warranty\.export/);
});
