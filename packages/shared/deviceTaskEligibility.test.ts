import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDeviceTaskEligibility, taskRequiresInstalledDevice } from './deviceTaskEligibility.js';

test('classifies maintenance and warranty tasks as device-subject tasks', () => {
  assert.equal(taskRequiresInstalledDevice('emergency_maintenance'), true);
  assert.equal(taskRequiresInstalledDevice('periodic_maintenance'), true);
  assert.equal(taskRequiresInstalledDevice('golden_warranty_offer'), true);
  assert.equal(taskRequiresInstalledDevice('device_demo'), false);
});

test('applies the installed-device modal rules to emergency maintenance', () => {
  assert.equal(evaluateDeviceTaskEligibility({ taskType: 'emergency_maintenance', deviceStatus: 'active' }).allowed, true);
  assert.equal(evaluateDeviceTaskEligibility({ taskType: 'emergency_maintenance', deviceStatus: 'registered' }).allowed, false);
});

test('periodic maintenance requires an active device and a service basis', () => {
  assert.equal(evaluateDeviceTaskEligibility({ taskType: 'periodic_maintenance', deviceStatus: 'active' }).code, 'SERVICE_BASIS_REQUIRED');
  assert.equal(evaluateDeviceTaskEligibility({ taskType: 'periodic_maintenance', deviceStatus: 'active', hasContract: true }).allowed, true);
  assert.equal(evaluateDeviceTaskEligibility({ taskType: 'periodic_maintenance', deviceStatus: 'active', hasActiveServiceAgreement: true }).allowed, true);
});

test('golden warranty offers reject devices with an active golden warranty', () => {
  assert.equal(evaluateDeviceTaskEligibility({ taskType: 'golden_warranty_offer', hasActiveGoldenWarranty: true }).code, 'ACTIVE_GOLDEN_WARRANTY_EXISTS');
  assert.equal(evaluateDeviceTaskEligibility({ taskType: 'golden_warranty_offer', hasActiveGoldenWarranty: false }).allowed, true);
});

test('device return requires an in-workshop device with a successful maintenance retrieval', () => {
  assert.equal(
    evaluateDeviceTaskEligibility({
      taskType: 'device_return',
      deviceStatus: 'in_workshop',
      hasSuccessfulMaintenanceRetrieval: false,
    }).code,
    'MAINTENANCE_RETRIEVAL_REQUIRED',
  );
  assert.equal(
    evaluateDeviceTaskEligibility({
      taskType: 'device_return',
      deviceStatus: 'in_workshop',
      hasSuccessfulMaintenanceRetrieval: true,
    }).allowed,
    true,
  );
});
