import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./clients.ts', import.meta.url), 'utf8');

test('statement «إجمالي المدفوع» counts payments only, never discounts or reversals', () => {
  const totalPaid = source.match(/COALESCE\(SUM\(CASE WHEN ([^)]*?) THEN amount_syp ELSE 0 END\), 0\) AS total_paid/);
  assert.ok(totalPaid, 'total_paid expression not found');
  assert.equal(totalPaid[1].trim(), "kind = 'payment'");
});

test('a discount still lowers the running balance', () => {
  assert.match(source, /CASE WHEN kind IN \('payment','discount'\) THEN amount_syp ELSE 0 END AS credit_amount/);
});
