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
  assert.match(sql, /entry\.received_at < \$3::date \+ INTERVAL '1 day'/);
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
