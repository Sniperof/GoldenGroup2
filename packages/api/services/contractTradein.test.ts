import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeContractTradeinDetails } from './contractTradein.js';

test('trade-in statistics are trimmed and preserved', () => {
  assert.deepEqual(
    normalizeContractTradeinDetails('tradein', '  C-2024-0042  ', 'good'),
    {
      ok: true,
      saleType: 'tradein',
      oldContractNumber: 'C-2024-0042',
      oldDeviceCondition: 'good',
    },
  );
});

test('trade-in requires an old contract number and a supported condition', () => {
  assert.equal(
    normalizeContractTradeinDetails('tradein', ' ', 'good').ok,
    false,
  );
  assert.equal(
    normalizeContractTradeinDetails('tradein', 'C-1', 'unknown').ok,
    false,
  );
});

test('non-trade-in sales clear stale statistical details', () => {
  assert.deepEqual(
    normalizeContractTradeinDetails('direct', 'C-OLD', 'damaged'),
    {
      ok: true,
      saleType: 'direct',
      oldContractNumber: null,
      oldDeviceCondition: null,
    },
  );
});

test('unsupported sale types fail closed', () => {
  const result = normalizeContractTradeinDetails('replacement', 'C-1', 'good');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'invalid_sale_type');
});
