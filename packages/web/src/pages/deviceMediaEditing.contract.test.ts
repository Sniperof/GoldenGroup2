import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const detailPage = readFileSync(new URL('./DeviceDetail.tsx', import.meta.url), 'utf8');
const managementPage = readFileSync(new URL('./DeviceManagement.tsx', import.meta.url), 'utf8');

test('device details exposes media editing only to catalog managers', () => {
  assert.match(detailPage, /hasAnyPermission\('device_models\.manage', 'catalog\.manage'\)/);
  assert.match(detailPage, /navigate\(`\/devices\?edit=\$\{device\.id\}`\)/);
  assert.match(detailPage, />\s*\u062aعديل الجهاز والوسائط\s*</);
});

test('management page resolves the requested device and opens the existing edit form', () => {
  assert.match(managementPage, /searchParams\.get\('edit'\)/);
  assert.match(managementPage, /devices\.find\(device => device\.id === deviceId\)/);
  assert.match(managementPage, /setEditingDevice\(requestedDevice\)/);
  assert.match(managementPage, /setIsAddingDevice\(true\)/);
});

test('device media editing matches backend permissions and supported document format', () => {
  assert.doesNotMatch(managementPage, /hasAnyPermission\('device_models\.manage', 'catalog\.manage', 'devices\.manage'\)/);
  assert.match(managementPage, /accept="application\/pdf,\.pdf"/);
  assert.doesNotMatch(managementPage, /\.docx|\.xlsx/);
  assert.match(managementPage, /setError\(err\?\.message \|\|/);
});

test('media replacement can reselect the same file and cannot save before upload finishes', () => {
  assert.match(managementPage, /event\.currentTarget\.value = ''/);
  assert.match(managementPage, /disabled=\{saving \|\| uploadingField !== null\}/);
  assert.match(managementPage, /جاري رفع الملفات/);
});
