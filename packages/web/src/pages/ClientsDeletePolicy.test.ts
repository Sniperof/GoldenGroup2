import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('clients page exposes only permission-gated individual soft deletion', () => {
  const page = readFileSync(new URL('./Clients.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8');

  assert.match(page, /hasPermission\('clients\.delete'\)/);
  assert.match(page, /void deleteClient\(c\.id\)/);
  assert.match(page, /await api\.clients\.delete\(id\)/);
  assert.match(page, /const payload = extractApiPayload\(err\)/);
  assert.match(page, /payload\?\.error/);
  assert.doesNotMatch(page, /bulkDelete|label: 'حذف'/);
  assert.doesNotMatch(api, /bulkDelete:/);
});
