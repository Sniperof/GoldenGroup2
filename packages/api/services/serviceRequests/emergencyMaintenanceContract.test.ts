import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const routeSource = fs.readFileSync(path.join(root, 'routes/serviceRequests.ts'), 'utf8');
const appRouteSource = fs.readFileSync(path.join(root, 'routes/appServiceRequests.ts'), 'utf8');
const promoteSource = fs.readFileSync(path.join(root, 'services/serviceRequests/promoteService.ts'), 'utf8');
const stateSource = fs.readFileSync(path.join(root, 'services/serviceRequests/stateMachine.ts'), 'utf8');
const mobileSource = fs.readFileSync(path.join(root, 'services/serviceRequests/mobileEmergencyMaintenanceIntake.ts'), 'utf8');

test('telemarketing gateway requires both call and service-request capabilities', () => {
  const start = routeSource.indexOf("'/internal-with-call'");
  const section = routeSource.slice(start, start + 14_000);
  assert.match(section, /requirePermission\('telemarketing\.calls\.create'\)/);
  assert.match(section, /requireInternalCallRequestCreatePermission/);
  assert.match(routeSource, /requirePermission\(familyKeyFor\(requestType, 'create'\)\)/);
  assert.match(section, /sourceCallLogId: callLogId/);
  assert.match(section, /await client\.query\('BEGIN'\)/);
  assert.match(section, /await client\.query\('COMMIT'\)/);
});

test('handoff is scoped to the target task branch and exceptional split permission', () => {
  const start = routeSource.indexOf("router.post('/:id/promote'");
  const section = routeSource.slice(start, start + 6_000);
  assert.match(section, /permission: 'open_tasks\.edit'/);
  assert.match(section, /permission: 'installed_devices\.create_external'/);
  assert.match(section, /permission: 'service_requests\.override_active_emergency'/);
  assert.match(section, /split_reason_required/);
});

test('emergency handoff enforces beneficiary device ownership, problems, transfer, and location decision', () => {
  assert.match(promoteSource, /installed_device_beneficiary_mismatch/);
  assert.match(promoteSource, /structured_problem_required/);
  assert.match(promoteSource, /active_device_transfer_blocks_handoff/);
  assert.match(promoteSource, /device_location_decision_required/);
});

test('intake resolution requires a linked beneficiary and emergency device facts', () => {
  assert.match(stateSource, /\$\{input\.toStatus\}_requires_beneficiary_client/);
  assert.match(stateSource, /resolved_at_intake_requires_installed_device/);
  assert.match(stateSource, /resolved_at_intake_requires_structured_problem/);
});

test('legacy periodic attachment is absent from the service request route', () => {
  assert.doesNotMatch(routeSource, /attach-periodic-task/);
});

test('catalog and free-text mobile devices enter the external-device resolution path', () => {
  const externalSelections = mobileSource.match(/deviceSource: 'external_device' as const/g) ?? [];
  assert.equal(externalSelections.length, 2);
});

test('mobile receives admin-managed safety and attachment vocabularies', () => {
  assert.match(appRouteSource, /\/emergency-maintenance\/options/);
  assert.match(appRouteSource, /emergency_maintenance_safety_indicators/);
  assert.match(appRouteSource, /emergency_maintenance_attachment_categories/);
});

test('emergency mobile submission requires an idempotency key', () => {
  assert.match(appRouteSource, /requestType === 'emergency_maintenance'[\s\S]*&& !req\.get\('Idempotency-Key'\)/);
  assert.match(appRouteSource, /idempotency_key_required/);
});
