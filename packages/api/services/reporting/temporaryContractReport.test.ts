import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TabularReportAccess } from './tabularReportAccess.js';
import { buildTemporaryContractQuery, TRIAL_GRACE_SETTING_KEY } from './temporaryContractReport.js';
import { columnsForGrantedScope, findTabularReport } from './tabularReportCatalog.js';

const globalAccess: TabularReportAccess = {
  scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 21,
};

function sqlFor(request: Record<string, unknown> = {}, access = globalAccess) {
  return buildTemporaryContractQuery(access, request as never, { limit: 10 });
}

test('the row set is every contract that STARTED as a trial, not those still typed as one', () => {
  const { sql } = sqlFor();

  assert.match(sql, /FROM contracts contract/);
  assert.match(sql, /contract\.started_as_temporary IS TRUE/);
  // Settling flips sale_subtype in place (migration 458), so filtering on the
  // subtype would erase every successful trial from the report.
  assert.doesNotMatch(sql, /contract\.sale_subtype = 'temporary'/);
});

test('branch and assigned scope are applied to the contract before any detail join', () => {
  const branch = sqlFor({}, { scope: 'BRANCH', grantedScope: 'BRANCH', branchIds: [1001], userId: 22 });
  assert.match(branch.sql, /contract\.branch_id = ANY\(\$1::int\[\]\)/);
  assert.deepEqual(branch.params[0], [1001]);

  const assigned = sqlFor({}, { scope: 'ASSIGNED', grantedScope: 'ASSIGNED', branchIds: [1001], userId: 23 });
  assert.match(assigned.sql, /scoped_user\.employee_id = contract\.sale_owner_id/);
  assert.ok(assigned.params.includes(23));
});

test('every one-to-many source is reduced to one row so the contract grain survives', () => {
  const { sql } = sqlFor();
  for (const lateral of ['device', 'sale_visit', 'installation', 'mediator', 'mediator_contact', 'contact', 'closing_task']) {
    assert.match(sql, new RegExp(`LEFT JOIN LATERAL \\([\\s\\S]*?\\) ${lateral} ON TRUE`));
  }
  // The device is a LATERAL rather than a plain join: a contract carrying two device
  // rows would otherwise duplicate the contract.
  assert.match(sql, /installed\.id = contract\.installed_device_id\s*\n?\s*OR \(contract\.installed_device_id IS NULL/);
});

test('the ordering is total, so snapshot row numbers cannot drift between batches', () => {
  assert.match(sqlFor().sql, /ORDER BY device\.installation_date DESC NULLS LAST, contract\.id DESC/);
});

test('sorting accepts a catalogue column and refuses anything else', () => {
  assert.match(sqlFor({ sortKey: 'customerName', sortDir: 'desc' }).sql,
    /ORDER BY "customerName" DESC NULLS LAST, device\.installation_date DESC NULLS LAST, contract\.id DESC/);
  assert.throws(() => sqlFor({ sortKey: 'contractId', sortDir: 'asc' }), /غير متاح للفرز/);
});

test('the outcome column and its filter read the same expression', () => {
  const { sql } = sqlFor();
  assert.match(sql, /WHEN contract\.temporary_settled_at IS NOT NULL THEN 'settled'/);
  assert.match(sql, /WHEN 'settled' THEN 'تثبيت'/);
  assert.match(sql, /WHEN 'discarded' THEN 'مُهمَل'/);

  for (const outcome of ['settled', 'cancelled', 'open', 'discarded']) {
    assert.match(sqlFor({ trialOutcome: outcome }).sql, /CASE\s*\n?\s*WHEN contract\.temporary_settled_at IS NOT NULL/);
  }
  assert.throws(() => sqlFor({ trialOutcome: 'returned' }), /نتيجة التجربة غير صالحة/);
});

test('the grace deadline is read from the admin setting, never from a hard-coded period', () => {
  const { sql } = sqlFor();
  assert.match(sql, new RegExp(`setting\\.key = '${TRIAL_GRACE_SETTING_KEY}'`));
  assert.match(sql, /device\.installation_date \+ \(/);
  // A row with no installation has no clock, so it must not receive a deadline.
  assert.match(sql, /CASE WHEN device\.installation_date IS NOT NULL/);
});

test('the grace filter reads the same deadline the column shows', () => {
  assert.match(sqlFor({ trialGraceState: 'within' }).sql, /\)::date >= CURRENT_DATE/);
  assert.match(sqlFor({ trialGraceState: 'elapsed' }).sql, /\)::date < CURRENT_DATE/);
  assert.match(sqlFor({ trialGraceState: 'unknown' }).sql, /\)::date IS NULL/);
  assert.throws(() => sqlFor({ trialGraceState: 'soon' }), /حالة المهلة غير صالحة/);
});

test('the closing block comes from the trial-return retrieval task alone', () => {
  const { sql } = sqlFor();
  assert.match(sql, /closing_task\.task_type = 'device_retrieval'/);
  assert.match(sql, /closing_task\.retrieval_purpose = 'trial_return'/);
  // Settling creates no task at all, so the label explains the blank instead of
  // leaving five of ten rows silently empty.
  assert.match(sql, /THEN 'تسوية في المكان — بلا مهمة'/);
  assert.match(sql, /closing_task\.trainee_name AS "closingTraineeName"/);
});

test('the contact columns come from a call linked to one of the contract tasks', () => {
  const { sql } = sqlFor();
  assert.match(sql, /FROM call_task_links link/);
  assert.match(sql, /linked_task\.contract_id = contract\.id/);
  assert.match(sql, /ORDER BY link\.is_primary DESC, call_log\.call_date DESC NULLS LAST/);
  // DEC-TC-5: not «the newest call to the customer» — one trial carries seven.
  assert.doesNotMatch(sql, /call_log\.customer_id = client\.id/);
});

test('the appointment source translates the raw system code and passes list values through', () => {
  const { sql } = sqlFor();
  assert.match(sql, /BTRIM\(contract\.sale_source\) = 'device_demo_task' THEN 'مهمة عرض جهاز'/);
  assert.match(sql, /ELSE BTRIM\(contract\.sale_source\)/);
});

test('the mediator is read from the contract snapshot, and its phone is resolved by identity', () => {
  const { sql } = sqlFor();
  assert.match(sql, /contract\.contract_referrers->0->>'referrerName'/);
  assert.match(sql, /mediator\.type = 'Client' AND referrer_client\.id = mediator\.entity_id/);
  assert.match(sqlFor({ mediatorType: 'unknown' }).sql, /mediator\.type IS NULL/);
  assert.throws(() => sqlFor({ mediatorType: 'Partner' }), /تصنيف الوسيط غير صالح/);
});

test('the team filters read the installation visit the columns display', () => {
  assert.match(sqlFor({ supervisorEmployeeId: 9 }).sql, /installation\.supervisor_employee_id = \$\d+/);
  assert.match(sqlFor({ technicianEmployeeId: 8 }).sql, /installation\.technician_employee_id = \$\d+/);
});

test('date filters are validated and bound, never interpolated', () => {
  const { sql, params } = sqlFor({
    installationFrom: '2026-08-01', installationTo: '2026-09-30',
    closingAppointmentFrom: '2026-09-01', closingAppointmentTo: '2026-09-30',
  });
  assert.match(sql, /device\.installation_date >= \$\d+::date/);
  assert.match(sql, /closing_task\.appointment_date <= \$\d+::date/);
  assert.ok(params.includes('2026-08-01') && params.includes('2026-09-30'));

  assert.throws(() => sqlFor({ installationFrom: '2026-13-01' }), /غير صالح/);
  assert.throws(() => sqlFor({ installationFrom: '2026-09-30', installationTo: '2026-09-01' }), /يجب ألا تكون بعد نهايته/);
});

test('the catalogue entry carries the agreed contract and every column it selects', () => {
  const definition = findTabularReport('daily_work.temporary_contract');
  assert.ok(definition, 'the report must be registered in the catalogue');
  assert.equal(definition.groupKey, 'daily_work');
  assert.deepEqual(definition.supportedScopes, ['GLOBAL', 'BRANCH', 'ASSIGNED']);
  assert.equal(definition.filters.dateRange, 'none');
  assert.equal(definition.rowIsBranch, true);
  assert.equal(definition.columns.length, 28);

  const globalColumns = columnsForGrantedScope(definition, 'GLOBAL');
  assert.equal(globalColumns.filter(column => column.key === 'branchName').length, 1);

  const { sql } = sqlFor();
  for (const column of definition.columns) {
    assert.match(sql, new RegExp(`AS "${column.key}"`), `column ${column.key} is not selected`);
    assert.ok(definition.guide.columnDescriptions[column.key], `column ${column.key} has no guide text`);
  }
});

test('the migration registers both capabilities and seeds the grace period the business set', () => {
  const migration = readFileSync('migrations/465_temporary_contract_report.sql', 'utf8');

  assert.match(migration, /reports\.daily_work\.temporary_contract\.view/);
  assert.match(migration, /reports\.daily_work\.temporary_contract\.export/);
  const declaredScopes = migration.match(/ARRAY\[[^\]]*\]::text\[\]/g) ?? [];
  assert.equal(declaredScopes.length, 2);
  for (const scopes of declaredScopes) assert.equal(scopes, "ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]");

  assert.match(migration, new RegExp(`'${TRIAL_GRACE_SETTING_KEY}', '30'`));
  assert.match(migration, /permission\.key = 'contracts\.view_list'/);
});
