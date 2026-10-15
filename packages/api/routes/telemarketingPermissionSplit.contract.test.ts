import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../migrations/468_split_supervisor_telemarketer_contact_visibility.sql', import.meta.url),
  'utf8',
);
const route = readFileSync(new URL('./telemarketing.ts', import.meta.url), 'utf8');

test('customer-service supervisor receives only assigned device-demo visibility', () => {
  assert.match(migration, /r\.name = 'customer_service_supervisor'[\s\S]*p\.key = 'telemarketing\.lists\.view_device_demo'/);
  assert.match(migration, /SELECT r\.id, p\.id, 'ASSIGNED'/);
  assert.match(migration, /r\.name = 'customer_service_supervisor'[\s\S]*p\.key = 'telemarketing\.lists\.view';/);
});

test('telemarketer receives broad branch visibility and loses the redundant restricted grant', () => {
  assert.match(migration, /r\.name = 'telemarkter'[\s\S]*p\.key = 'telemarketing\.lists\.view'/);
  assert.match(migration, /SELECT r\.id, p\.id, 'BRANCH'/);
  assert.match(migration, /r\.name = 'telemarkter'[\s\S]*p\.key = 'telemarketing\.lists\.view_device_demo';/);
});

test('snapshot accepts both permissions and applies the device-demo whole-contact filter', () => {
  assert.match(route, /requirePermission\('telemarketing\.lists\.view', 'telemarketing\.lists\.view_device_demo'\)/);
  assert.match(route, /getTelemarketingTaskTypeScope\(req\.authContext\) === 'device_demo'/);
  assert.match(route, /ot2\.task_type = 'device_demo'/);
});
