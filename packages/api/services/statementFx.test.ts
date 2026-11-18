import test from 'node:test';
import assert from 'node:assert/strict';
import { contractLineFxReference } from './statementFx.js';

test('USD-linked installment charge shows its fixed USD at the contract rate', () => {
  const ref = contractLineFxReference({
    kind: 'charge', source_type: 'contract_installment', debit_amount: 2_673_766,
    fx_contract_rate: 15_000, fx_installment_usd: 178.25,
  });
  assert.deepEqual(ref, { usd: 178.25, rate: 15_000, label: 'قيمة القسط 178.25 $ بسعر العقد 15,000 ل.س/$' });
});

test('signing charge converts at the contract rate', () => {
  const ref = contractLineFxReference({
    kind: 'charge', source_type: 'contract', debit_amount: 12_000_000, fx_contract_rate: 15_000,
  });
  assert.equal(ref?.usd, 800);
  assert.equal(ref?.label, 'ما يعادل 800.00 $ بسعر العقد 15,000 ل.س/$');
});

test('a contract without a snapshot uses the rate on the line date', () => {
  const ref = contractLineFxReference({
    kind: 'charge', source_type: 'contract', debit_amount: 150_000, fx_date_rate: 14_000,
  });
  assert.equal(ref?.label, 'ما يعادل 10.71 $ بسعر صرف 14,000 ل.س/$');
});

test('a write-off at cancellation (credit) is converted too', () => {
  const ref = contractLineFxReference({
    kind: 'discount', source_type: 'contract_installment', credit_amount: 4_400_000, fx_date_rate: 14_000,
  });
  assert.equal(ref?.usd, 314.29);
});

test('payments, non-contract lines and lines with no rate are left alone', () => {
  assert.equal(contractLineFxReference({ kind: 'payment', source_type: 'contract_payment', credit_amount: 1, fx_date_rate: 1 }), null);
  assert.equal(contractLineFxReference({ kind: 'charge', source_type: 'emergency_maintenance', debit_amount: 1, fx_date_rate: 1 }), null);
  assert.equal(contractLineFxReference({ kind: 'charge', source_type: 'contract', debit_amount: 1 }), null);
});
