import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const routeSource = fs.readFileSync(path.join(root, 'packages/api/routes/appDevices.ts'), 'utf8');
const docsSource = fs.readFileSync(path.join(root, 'docs/api/mobile-devices-api-reference.md'), 'utf8');

test('mobile device detail is authenticated and ownership-scoped in SQL', () => {
  assert.match(routeSource, /router\.get\('\/me\/devices\/:deviceId', requireAppAuth/);
  assert.match(routeSource, /WHERE d\.id = \$1 AND d\.customer_id = \$2/);
  assert.match(routeSource, /Do not confirm that a foreign device id exists/);
  assert.match(routeSource, /return res\.status\(404\)\.json\(\{ error: 'الجهاز غير موجود' \}\)/);
});

test('mobile device detail exposes the agreed customer-facing summary', () => {
  for (const field of [
    'installationLat',
    'installationLng',
    'activeTaskCount',
    'activeServiceAgreement',
    'warrantyStartDate',
    'warrantyMonths',
    'warrantyVisits',
  ]) {
    assert.match(routeSource, new RegExp(`"${field}"`));
    assert.ok(docsSource.includes(`| \`${field}\``), `docs missing ${field}`);
  }
  assert.match(routeSource, /agreementNumber/);
  assert.doesNotMatch(routeSource, /fee_syp/);
  assert.doesNotMatch(routeSource, /technician_notes/);
});
