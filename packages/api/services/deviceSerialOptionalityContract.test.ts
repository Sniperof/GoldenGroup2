import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('migrations/436_installed_device_serial_optional.sql');
const installedDevicesRoute = read('packages/api/routes/installedDevices.ts');
const contractsRoute = read('packages/api/routes/contracts.ts');
const contractForm = read('packages/web/src/pages/contracts/ContractForm.tsx');
const devicesTab = read('packages/web/src/pages/clientProfile/DevicesTab.tsx');

test('migration keeps NULL allowed and uniqueness limited to non-empty serials', () => {
  assert.match(migration, /ALTER COLUMN serial_number DROP NOT NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_installed_devices_serial_normalized/);
  assert.match(migration, /WHERE serial_number IS NOT NULL[\s\S]*btrim\(serial_number\) <> ''/);
});

test('server accepts an omitted serial for external devices and contract approval', () => {
  assert.doesNotMatch(installedDevicesRoute, /Serial number is required/);
  assert.doesNotMatch(contractsRoute, /الرقم التسلسلي للجهاز مطلوب/);
  assert.match(installedDevicesRoute, /assertDeviceSerialAvailable\(db, serialNumber\)/);
});

test('web forms present the serial as optional and normalize an empty value to null', () => {
  assert.doesNotMatch(contractForm, /if \(!serialNumber\.trim\(\)\)/);
  assert.match(contractForm, /Field label="الرقم التسلسلي \(اختياري\)"/);
  assert.match(contractForm, /serialNumber: serialNumber\.trim\(\) \|\| null/);
  assert.doesNotMatch(devicesTab, /setExternalError\('الرقم التسلسلي مطلوب\.'/);
  assert.match(devicesTab, /serialNumber: externalSerial\.trim\(\) \|\| null/);
});

test('missing-field projection no longer classifies an absent serial as incomplete', () => {
  assert.doesNotMatch(installedDevicesRoute, /'serialNumber',[\s\S]{0,120}THEN 'missing'/);
});
