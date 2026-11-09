import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('clients page exposes only permission-gated individual soft deletion', () => {
  const page = readFileSync(new URL('./Clients.tsx', import.meta.url), 'utf8');
  const dialog = readFileSync(new URL('../components/clients/ClientDeleteDialog.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8');

  assert.match(page, /hasPermission\('clients\.delete'\)/);
  assert.match(page, /deleteClient\(c\.id\)/);
  assert.match(page, /<ClientDeleteDialog/);
  // The confirmation and the refusal are an in-app dialog, not browser popups.
  assert.match(dialog, /await api\.clients\.delete\(client\.id\)/);
  assert.match(dialog, /payload\?\.code === 'CLIENT_DELETE_BLOCKED'/);
  assert.match(dialog, /payload\?\.error/);
  assert.doesNotMatch(dialog, /\bconfirm\(|\balert\(/);
  assert.doesNotMatch(page, /bulkDelete|label: 'حذف'/);
  assert.doesNotMatch(api, /bulkDelete:/);
});
