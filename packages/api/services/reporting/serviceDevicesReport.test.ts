import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ReportingError } from './reportingError.js';
import { buildServiceDevicesQuery } from './serviceDevicesReport.js';

const globalAccess = { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 } as const;

test('service device report keeps one installed device as its row grain', () => {
  const query = buildServiceDevicesQuery(globalAccess, {}, { limit: 50 });
  assert.match(query.sql, /FROM installed_devices device/);
  assert.match(query.sql, /device\.id AS "deviceId"/);
  assert.match(query.sql, /COUNT\(\*\) OVER\(\)/);
  assert.match(query.sql, /ORDER BY client\.name, device\.id/);
});

test('last completed visit is device-linked and isolates parts and payments to that device', () => {
  const query = buildServiceDevicesQuery(globalAccess, {}, { limit: 50 });
  assert.match(query.sql, /task\.device_id = device\.id AND task\.status IN \('completed', 'closed'\)/);
  assert.match(query.sql, /task\.field_visit_id = last_completed_visit\.id AND task\.device_id = device\.id/);
  assert.match(query.sql, /movement\.kind = 'payment'/);
  assert.match(query.sql, /task\.source_open_task_id/);
  assert.match(query.sql, /STRING_AGG\(part\.part_name_snapshot \|\| ' × ' \|\| part\.quantity::text/);
});

test('report uses device branch and installation geography for scope filters', () => {
  const query = buildServiceDevicesQuery(
    { scope: 'BRANCH', grantedScope: 'BRANCH', branchIds: [2, 4], userId: 7 },
    { geoIds: '10,11,11' },
    { limit: 25 },
  );
  assert.match(query.sql, /device\.branch_id = ANY\(\$1::int\[\]\)/);
  assert.match(query.sql, /device\.installation_geo_unit_id = ANY\(\$2::int\[\]\)/);
  assert.deepEqual(query.params.slice(0, 2), [[2, 4], [10, 11]]);
});

test('whatsapp message uses notes only when the latest contact is whatsapp text', () => {
  const query = buildServiceDevicesQuery(globalAccess, { lastContactChannel: 'whatsapp' }, { limit: 10 });
  assert.match(query.sql, /CASE WHEN last_contact\.communication_channel = 'whatsapp_text' THEN NULLIF\(last_contact\.notes, ''\) END/);
  assert.match(query.sql, /last_contact\.communication_channel = 'whatsapp_text'/);
});

test('ASSIGNED scope is denied because the report has no assigned subject', () => {
  assert.throws(
    () => buildServiceDevicesQuery(
      { scope: 'ASSIGNED', grantedScope: 'ASSIGNED', branchIds: [2], userId: 7 },
      {},
      { limit: 10 },
    ),
    (error: unknown) => error instanceof ReportingError && error.status === 403,
  );
});

test('filter values are applied to displayed report fields', () => {
  const query = buildServiceDevicesQuery(globalAccess, {
    search: '123', deviceStatus: 'active', warrantyStatus: 'active', customerRating: 'Committed',
    contactEmployeeId: 9, replacedParts: 'yes', minPaidAmount: 1000, maxPaidAmount: 5000,
    installationFrom: '2026-01-01', installationTo: '2026-12-31',
  }, { limit: 10 });
  assert.match(query.sql, /client\.name ILIKE/);
  assert.match(query.sql, /device\.status =/);
  assert.match(query.sql, /last_contact\.employee_id =/);
  assert.match(query.sql, /last_parts\.summary IS NOT NULL/);
  assert.match(query.sql, /device\.installation_date >=/);
  assert.match(query.sql, /device\.installation_date <=/);
});

test('permission migration defines independent view and export with GLOBAL and BRANCH only', () => {
  const migration = readFileSync('migrations/437_service_installed_devices_report.sql', 'utf8');
  assert.match(migration, /reports\.service\.installed_devices\.view/);
  assert.match(migration, /reports\.service\.installed_devices\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH'\]::text\[\]/);
  assert.match(migration, /grants\.scope_type IN \('GLOBAL', 'BRANCH'\)/);
  assert.doesNotMatch(migration, /ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]/);
});
