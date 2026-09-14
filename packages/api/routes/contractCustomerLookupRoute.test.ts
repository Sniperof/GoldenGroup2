import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('./contracts.ts', import.meta.url), 'utf8');

test('customer lookup routes are registered before the generic contract id route', () => {
  const lookupPosition = route.indexOf("router.get('/customer-lookup'");
  const contextPosition = route.indexOf("router.get('/customer-context/:clientId'");
  const contractPosition = route.indexOf("router.get('/:id'");

  assert.ok(lookupPosition >= 0);
  assert.ok(contextPosition > lookupPosition);
  assert.ok(contractPosition > contextPosition);
});

test('manual contract POST reloads the scoped customer and ignores a posted name', () => {
  assert.match(route, /if \(rawSourceVisitId === null \|\| rawSourceVisitId === ''\)/);
  assert.match(route, /loadContractCustomerContext\([\s\S]*?targetBranchId,[\s\S]*?customerId/);
  assert.match(route, /c\.customerName = customer\.name/);
});
