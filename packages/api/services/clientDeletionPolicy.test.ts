import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('client deletion is soft, subject-authorized, and bulk hard deletion stays closed', () => {
  const route = readFileSync(new URL('../routes/clients.ts', import.meta.url), 'utf8');

  assert.match(route, /router\.delete\('\/:id', requirePermission\('clients\.delete'\)/);
  assert.match(route, /const access = canDeleteClient\(authContext, subject\)/);
  assert.match(route, /SET deleted_at = NOW\(\), deleted_by = \$1, is_active = FALSE/);
  assert.match(route, /router\.post\('\/bulk-delete', requirePermission\('clients\.delete'\)/);
  assert.match(route, /res\.status\(410\)\.json/);
  assert.doesNotMatch(route, /DELETE FROM clients/);
});
