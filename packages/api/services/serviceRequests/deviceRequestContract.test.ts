import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../../../migrations/413_device_request_service_request_v1.sql', import.meta.url), 'utf8');
const handoff = readFileSync(new URL('./deviceRequestHandoffService.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../routes/serviceRequests.ts', import.meta.url), 'utf8');

test('device request remains an extension of service_requests with immutable purpose and device snapshots', () => {
  assert.match(migration, /ALTER TABLE public\.service_requests/);
  assert.match(migration, /device_request_purpose_snapshot JSONB/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.service_request_device_interests/);
  assert.match(migration, /device_snapshot JSONB NOT NULL/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS public\.device_requests/);
});

test('device-request handoff fixes branch, beneficiary, employee and requested-device invariants', () => {
  assert.match(handoff, /beneficiary_client_required/);
  assert.match(handoff, /branch_resolution_status !== 'resolved'/);
  assert.match(handoff, /eligible_employee_not_found/);
  assert.match(handoff, /requested_device_model_required/);
  assert.match(handoff, /source_service_request_id/);
  assert.match(handoff, /open_task_devices/);
  assert.match(routes, /handoff-device-request'[\s\S]*requireTypedPermission\('decide'\)/);
  assert.match(routes, /permission: 'open_tasks\.edit'/);
});
