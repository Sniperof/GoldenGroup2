import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildClientLifecycleStatusSql } from './customerOwnership.js';

test('transferred company devices make their current customer OP', () => {
  const sql = buildClientLifecycleStatusSql('client_row');

  assert.match(sql, /FROM installed_devices lifecycle_device/);
  assert.match(sql, /lifecycle_device\.customer_id = client_row\.id/);
  assert.doesNotMatch(sql, /lifecycle_device\.device_source = 'external'/);
});

test('installed-device projection prefers the current owner over the source contract customer', () => {
  const route = readFileSync(new URL('../routes/installedDevices.ts', import.meta.url), 'utf8');

  assert.match(route, /COALESCE\(cl\.name, c\.customer_name\) AS "customerName"/);
  assert.doesNotMatch(route, /COALESCE\(c\.customer_name, cl\.name\) AS "customerName"/);
});

test('device profile loads task history by physical device with subject and branch enforcement', () => {
  const route = readFileSync(new URL('../routes/openTasks.ts', import.meta.url), 'utf8');
  const page = readFileSync(
    new URL('../../web/src/pages/devices/DeviceProfilePage.tsx', import.meta.url),
    'utf8',
  );

  assert.match(route, /router\.get\('\/device\/:deviceId', requirePermission\('open_tasks\.view'\)/);
  assert.match(route, /canViewOpenTask\(authContext, device\.branch_id\)/);
  assert.match(route, /WHERE ot\.device_id = \$1/);
  assert.match(route, /ot\.branch_id = ANY\(\$\$\{params\.length\}::int\[\]\)/);
  assert.match(page, /api\.openTasks\.listByDevice\(deviceId\)/);
  assert.doesNotMatch(page, /api\.openTasks\.listByClient\(dev\.customerId\)/);
});

test('successful cross-customer transfer cancels the previous customer periodic schedule', () => {
  const reflection = readFileSync(
    new URL('./visitTaskResultReflection.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    reflection,
    /if \(ownershipTransferred\) \{[\s\S]*cancelUpcomingPeriodicMaintenanceForTransfer/,
  );
  assert.match(reflection, /fromClientId: Number\(vt\.from_client_id\)/);
  assert.match(reflection, /cancelledPeriodicTaskIds/);
});

test('historical transfer reconciliation cancels only upcoming old-customer periodic tasks', () => {
  const migration = readFileSync(
    new URL('../../../migrations/392_device_transfer_cancel_old_periodic.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /transfer_detail\.ownership_transferred = TRUE/);
  assert.match(migration, /transfer_detail\.from_client_id = periodic\.client_id/);
  assert.match(migration, /device\.customer_id <> periodic\.client_id/);
  assert.match(migration, /periodic\.status IN \([\s\S]*'waiting_execution'/);
  assert.doesNotMatch(migration, /periodic\.status IN \([\s\S]*'in_execution'/);
  assert.match(migration, /UPDATE visit_tasks/);
  assert.match(migration, /device_possession_transferred_historical_reconciliation/);
});
