import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./gifts.ts', import.meta.url), 'utf8');

test('gift promise conditions use gift visibility and return every active configured value', () => {
  const start = source.indexOf("router.get('/promise-conditions'");
  const end = source.indexOf("router.patch('/records/:id/referral-promise'", start);
  assert.ok(start > 0);
  assert.ok(end > start);
  const route = source.slice(start, end);
  assert.match(route, /requirePermission\('contract_gifts\.view'\)/);
  assert.match(route, /category='gift_promise_conditions'/);
  assert.match(route, /is_active=TRUE/);
  assert.doesNotMatch(route, /reference_data\.lookup/);
  assert.doesNotMatch(route, /value IN/);
});

test('seeded technical condition keys receive their designed Arabic labels', () => {
  assert.match(source, /contract_referrer_gift: 'هدية وسيط العقد'/);
  assert.match(source, /cash_contract: 'توقيع عقد نقدي'/);
  assert.match(source, /after_second_installment: 'الاستحقاق بعد الدفعة الثانية'/);
  assert.match(source, /multiple_contracts: 'شراء أكثر من عقد'/);
  assert.match(source, /administrative_commitment: 'التزام إداري'/);
  assert.match(source, /branch_manager_decision: 'قرار مدير الفرع'/);
  assert.match(source, /gift_contract: 'عقد هدية معتمد'/);
});
