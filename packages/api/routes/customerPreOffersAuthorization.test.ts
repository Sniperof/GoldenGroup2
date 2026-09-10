import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./customerPreOffers.ts', import.meta.url), 'utf8');

test('standalone pre-offer creation accepts client edit and preserves task-edit compatibility', () => {
  assert.match(
    source,
    /'\/:id\/pre-offers',\s*requirePermission\('clients\.edit',\s*'open_tasks\.edit'\)/,
  );
  assert.match(source, /canEditClient\(authContext, clientRows\[0\]\)/);
  assert.match(source, /authorize\(authContext, \{ permission: 'open_tasks\.edit', branchId \}\)/);
});

test('standalone pre-offer creation enforces device scope on the server', () => {
  assert.match(source, /assertDeviceModelInScope\(authContext, deviceModelId, branchId\)/);
  assert.match(source, /code: deviceAccess\.reason/);
});
