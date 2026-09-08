import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TabularReportAccess } from './tabularReportAccess.js';
import { buildServiceDuesQuery } from './serviceDuesReport.js';

const globalAccess: TabularReportAccess = {
  scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 17,
};

const dates = {
  fromDate: '2026-08-01', toDate: '2026-08-31', financialAsOfDate: '2026-08-20',
};

test('service dues keeps one installment grain, opens rows at the cutoff, and reports money before each due date', () => {
  const { sql, params } = buildServiceDuesQuery(globalAccess, dates, { limit: 10 });

  assert.match(sql, /FROM contract_installments installment/);
  assert.match(sql, /historical_installment\.remaining_balance > 0/);
  assert.match(sql, /entry\.received_at < \(\(\$3::text::date \+ 1\)::text \|\| ' 00:00'\)::timestamp AT TIME ZONE 'Asia\/Damascus'/);
  assert.match(sql, /movement\.occurred_at < \(installment\.due_date::timestamp AT TIME ZONE 'Asia\/Damascus'\)/);
  assert.match(sql, /entry\.contract_id = contract\.id/);
  assert.match(sql, /entry\.received_at < \(installment\.due_date::timestamp AT TIME ZONE 'Asia\/Damascus'\)/);
  assert.match(sql, /AS "lastPaymentMethod"/);
  assert.match(sql, /COUNT\(\*\) OVER\(\)::int AS "totalRows"/);
  assert.deepEqual(params.slice(0, 3), ['2026-08-01', '2026-08-31', '2026-08-20']);
});

test('service dues aggregates task contacts and results before joining the installment grain', () => {
  const { sql } = buildServiceDuesQuery(globalAccess, dates, { limit: 10 });

  assert.match(sql, /task\.installment_id = installment\.id[\s\S]*ORDER BY result\.closed_at DESC/);
  assert.match(sql, /JOIN call_task_links link ON link\.task_id = task\.id/);
  assert.match(sql, /ORDER BY call\.call_date DESC, call\.id DESC/);
  assert.match(sql, /ORDER BY visit\.scheduled_date ASC/);
});

test('service dues enforces branch and assigned subject scope independently of filters', () => {
  const access: TabularReportAccess = {
    scope: 'ASSIGNED', grantedScope: 'ASSIGNED', branchIds: [1002], userId: 77,
  };
  const { sql, params } = buildServiceDuesQuery(access, dates, { limit: 10 });

  assert.match(sql, /COALESCE\(contract\.service_branch_id, contract\.branch_id\) = ANY\(\$1::int\[\]\)/);
  assert.match(sql, /installment\.collection_owner_id = \$2/);
  assert.deepEqual(params.slice(0, 2), [[1002], 77]);
});

test('service dues validates required dates and allow-listed filters', () => {
  assert.throws(
    () => buildServiceDuesQuery(globalAccess, { fromDate: '2026-08-01', toDate: '2026-08-31' }, { limit: 10 }),
    /تاريخ الحالة المالية مطلوب/,
  );
  assert.throws(
    () => buildServiceDuesQuery(globalAccess, { ...dates, paymentType: 'card' }, { limit: 10 }),
    /نوع السداد غير صالح/,
  );
  assert.throws(
    () => buildServiceDuesQuery(globalAccess, { ...dates, latestCollectionResult: 'unknown' }, { limit: 10 }),
    /نتيجة التحصيل غير صالحة/,
  );
});

test('service dues permission migration registers both capabilities without an export baseline grant', () => {
  const migration = readFileSync('migrations/450_service_dues_report.sql', 'utf8');
  assert.match(migration, /reports\.service\.dues\.view/);
  assert.match(migration, /reports\.service\.dues\.export/);
  assert.match(migration, /JOIN public\.permissions permission[\s\S]*permission\.key = 'contracts\.view_list'/);
  assert.doesNotMatch(migration, /source_permission\.key = 'contracts\.export'/);
});

test('the receivable kind reads the same COALESCE the source column falls back through', () => {
  const { sql, params } = buildServiceDuesQuery(globalAccess, {
    ...dates, receivableSourceType: 'maintenance_task',
  }, { limit: 10 });

  // An installment with no collection task yet has no source type, and the source
  // column already reads it as the contract's own money — so the filter must read it
  // the same way or «قيمة العقد» would silently exclude those rows.
  assert.match(sql, /COALESCE\(latest_task\.receivable_source_type, 'contract'\) = \$\d+/);
  assert.match(sql, /CASE COALESCE\(latest_task\.receivable_source_type, 'contract'\)[\s\S]*AS "receivableSourceKind"/);
  assert.ok(params.includes('maintenance_task'));

  assert.throws(
    () => buildServiceDuesQuery(globalAccess, { ...dates, receivableSourceType: 'gift' }, { limit: 10 }),
    /مصدر الاستحقاق غير صالح/,
  );
});

test('the device filter and the device column resolve the same single device', () => {
  const { sql, params } = buildServiceDuesQuery(globalAccess, {
    ...dates, deviceModel: 'catalog:12',
  }, { limit: 10 });

  // One lateral, consumed by the column, by the filter and by the event date: a
  // two-device contract must not name one device and date another.
  assert.match(sql, /\) contract_device ON TRUE/);
  assert.match(sql, /COALESCE\(contract_device\.model_name, 'غير محدد'\) AS "deviceModelName"/);
  assert.match(sql, /contract_device\.device_model_id = \$\d+/);
  assert.match(sql, /ELSE contract_device\.installation_date/);
  assert.doesNotMatch(sql, /\) device ON TRUE/);
  assert.ok(params.includes(12));

  const external = buildServiceDuesQuery(globalAccess, {
    ...dates, deviceModel: 'external:جهاز خارجي',
  }, { limit: 10 });
  assert.match(external.sql, /contract_device\.device_model_id IS NULL/);
  assert.ok(external.params.includes('جهاز خارجي'));
});

test('the last-contact filter reads the contact the row displays, after the pick', () => {
  const { sql, params } = buildServiceDuesQuery(globalAccess, {
    ...dates, contactEmployeeId: 41,
  }, { limit: 10 });

  assert.match(sql, /last_contact\.caller_id = \$\d+/);
  assert.match(sql, /SELECT call\.call_date,\s*\n\s*call\.caller_id,/);
  assert.ok(params.includes(41));

  assert.throws(
    () => buildServiceDuesQuery(globalAccess, { ...dates, contactEmployeeId: 'x' }, { limit: 10 }),
    /موظف آخر اتصال غير صالح/,
  );
});

test('the collection-appointment range and its presence read the same lateral', () => {
  const ranged = buildServiceDuesQuery(globalAccess, {
    ...dates, collectionAppointmentFrom: '2026-09-01', collectionAppointmentTo: '2026-09-30',
  }, { limit: 10 });
  assert.match(ranged.sql, /next_appointment\.scheduled_date >= \$\d+::date/);
  assert.match(ranged.sql, /next_appointment\.scheduled_date <= \$\d+::date/);

  // The half a date range cannot express: receivables nobody has scheduled a visit for.
  const none = buildServiceDuesQuery(globalAccess, {
    ...dates, collectionAppointmentPresence: 'none',
  }, { limit: 10 });
  assert.match(none.sql, /next_appointment\.scheduled_date IS NULL/);
  const scheduled = buildServiceDuesQuery(globalAccess, {
    ...dates, collectionAppointmentPresence: 'scheduled',
  }, { limit: 10 });
  assert.match(scheduled.sql, /next_appointment\.scheduled_date IS NOT NULL/);

  assert.throws(
    () => buildServiceDuesQuery(globalAccess, {
      ...dates, collectionAppointmentFrom: '2026-09-30', collectionAppointmentTo: '2026-09-01',
    }, { limit: 10 }),
    /بداية مدى موعد التحصيل القادم يجب ألا تكون بعد نهايته/,
  );
  assert.throws(
    () => buildServiceDuesQuery(globalAccess, { ...dates, collectionAppointmentPresence: 'maybe' }, { limit: 10 }),
    /حالة موعد التحصيل غير صالحة/,
  );
});
