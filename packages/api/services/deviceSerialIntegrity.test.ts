import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEVICE_SERIAL_CONFLICT_CODE,
  DEVICE_SERIAL_UNIQUE_INDEX,
  DeviceSerialConflictError,
  assertDeviceSerialAvailable,
  deviceSerialConflictPayload,
  isDeviceSerialUniqueViolation,
  normalizeDeviceSerialNumber,
} from './deviceSerialIntegrity.js';

test('normalizes surrounding whitespace while preserving serial casing', () => {
  assert.equal(normalizeDeviceSerialNumber('  AbC-123  '), 'AbC-123');
  assert.equal(normalizeDeviceSerialNumber('   '), null);
  assert.equal(normalizeDeviceSerialNumber(null), null);
});

test('preflight compares normalized serial globally and excludes the current device/contract', async () => {
  let capturedParams: any[] | undefined;
  const db = {
    async query(_sql: string, params?: any[]) {
      capturedParams = params;
      return { rows: [] };
    },
  };

  const serial = await assertDeviceSerialAvailable(db, ' test-1 ', { deviceId: 9, contractId: 22 });
  assert.equal(serial, 'test-1');
  assert.deepEqual(capturedParams, ['test-1', 9, 22]);
});

test('an omitted serial is accepted without running a duplicate lookup', async () => {
  let queried = false;
  const db = {
    async query() {
      queried = true;
      return { rows: [] };
    },
  };

  assert.equal(await assertDeviceSerialAvailable(db, '   '), null);
  assert.equal(await assertDeviceSerialAvailable(db, null), null);
  assert.equal(queried, false);
});

test('preflight rejects an existing normalized serial without exposing the other device', async () => {
  const db = { async query() { return { rows: [{ exists: true }] }; } };
  await assert.rejects(
    () => assertDeviceSerialAvailable(db, 'TEST-1'),
    (error: unknown) => error instanceof DeviceSerialConflictError
      && error.code === DEVICE_SERIAL_CONFLICT_CODE,
  );
});

test('maps only the installed-device serial unique violation to a 409 payload', () => {
  const violation = { code: '23505', constraint: DEVICE_SERIAL_UNIQUE_INDEX };
  assert.equal(isDeviceSerialUniqueViolation(violation), true);
  assert.deepEqual(deviceSerialConflictPayload(violation), {
    error: 'الرقم التسلسلي مستخدم لجهاز آخر',
    code: DEVICE_SERIAL_CONFLICT_CODE,
  });
  assert.equal(deviceSerialConflictPayload({ code: '23505', constraint: 'another_index' }), null);
});
