import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const standaloneSource = fs.readFileSync(new URL('./StandaloneDeviceOffersModal.tsx', import.meta.url), 'utf8');
const taskSource = fs.readFileSync(new URL('./DeviceOfferModal.tsx', import.meta.url), 'utf8');

test('standalone offers do not let optional lookups hide a successful device list', () => {
  assert.match(standaloneSource, /employeeClosers\(\)\.catch\(\(\) => \[\]\)/);
  assert.match(standaloneSource, /getItemsByCode\('no_closing_reasons'\)\.catch\(\(\) => \[\]\)/);
});

test('device-demo tasks do not let optional lookups hide a successful device list', () => {
  assert.match(taskSource, /employeeClosers\(\)\.catch\(\(\) => \[\]\)/);
  assert.match(taskSource, /getItemsByCode\('device_demo_creation_reasons'\)\.catch\(\(\) => \[\]\)/);
  assert.match(taskSource, /getItemsByCode\('no_closing_reasons'\)\.catch\(\(\) => \[\]\)/);
});
