import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const route = fs.readFileSync(path.join(root, 'packages/api/routes/installedDevices.ts'), 'utf8');
const openTasksRoute = fs.readFileSync(path.join(root, 'packages/api/routes/openTasks.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/435_device_delivery_suspension.sql'), 'utf8');
const service = fs.readFileSync(path.join(root, 'packages/api/services/deviceDeliverySuspension.ts'), 'utf8');
const shared = fs.readFileSync(path.join(root, 'packages/shared/types.ts'), 'utf8');

test('migration defines the status, independent permission and fixed reasons', () => {
  assert.match(migration, /'delivery_suspended'/);
  assert.match(migration, /installed_devices\.delivery_suspension\.manage/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH'\]/);
  assert.match(migration, /delivery_suspended_customer_absent/);
  assert.match(migration, /trg_guard_suspended_device_delivery_task/);
  assert.match(migration, /FOR KEY SHARE/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+(?:public\.)?role_permission_grants/i);
  assert.doesNotMatch(service, /SELECT\s+DISTINCT[\s\S]*FOR\s+UPDATE/i);
});

test('dedicated endpoints enforce the permission and generic patch cannot enter the state', () => {
  assert.match(route, /\/:id\/suspend-delivery'[\s\S]*requirePermission\('installed_devices\.delivery_suspension\.manage'\)/);
  assert.match(route, /\/:id\/resume-delivery'[\s\S]*requirePermission\('installed_devices\.delivery_suspension\.manage'\)/);
  assert.match(route, /delivery_suspension_workflow_required/);
  assert.match(openTasksRoute, /deviceStatusFromCurrentDevice === 'delivery_suspended'[\s\S]*device_delivery_suspended/);
});

test('the shared device contract includes delivery_suspended', () => {
  assert.match(shared, /export type DeviceStatus[\s\S]*'delivery_suspended'/);
});
