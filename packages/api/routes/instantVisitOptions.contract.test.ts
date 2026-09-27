import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('./fieldVisits.ts', import.meta.url), 'utf8');

test('instant visit options and create use the same operation permission', () => {
  assert.match(route, /router\.get\('\/instant\/options', requirePermission\('field_visits\.create_instant'\)/);
  assert.match(route, /router\.post\('\/instant', requirePermission\('field_visits\.create_instant'\)/);
});

test('instant visit options are registered before generic visit-id routes', () => {
  const options = route.indexOf("router.get('/instant/options'");
  const generic = route.indexOf("router.post('/:id/start'");
  assert.ok(options >= 0 && generic >= 0 && options < generic);
});
