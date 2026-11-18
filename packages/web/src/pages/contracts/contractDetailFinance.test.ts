import test from 'node:test';
import assert from 'node:assert/strict';
import { computeContractFinance, installmentDisplayStatus } from './contractDetailFinance';

const TODAY = new Date('2026-11-17T10:00:00Z');

test('refunds reduce what was paid instead of adding to it', () => {
  const f = computeContractFinance({
    status: 'active', paymentType: 'cash', finalPrice: 150_000, basePrice: 150_000,
    paymentEntries: [
      { amountSyp: 150_000, entryType: 'collection' },
      { amountSyp: 50_000, entryType: 'refund' },
    ],
    installments: [],
  }, TODAY);
  assert.equal(f.netPaid, 100_000);
  assert.deepEqual(f.remaining, { kind: 'live', amount: 50_000 });
});

test('a cancelled contract shows its balance as voided, not as a live debt', () => {
  // LEG-47080: 9.8M, 1M signing, installments 1M (paid) + 4.4M (open)
  const f = computeContractFinance({
    status: 'cancelled', paymentType: 'installment', finalPrice: 9_800_000, basePrice: 9_800_000,
    downPayment: 1_000_000,
    paymentEntries: [
      { amountSyp: 1_000_000, installmentId: null },
      { amountSyp: 1_000_000, installmentId: 11 },
    ],
    installments: [
      { installmentNumber: 1, dueDate: '2026-04-05', amountSyp: 1_000_000, paidAmount: 1_000_000, remainingBalance: 0 },
      { installmentNumber: 2, dueDate: '2026-07-04', amountSyp: 4_400_000, paidAmount: 0, remainingBalance: 4_400_000 },
    ],
  }, TODAY);
  assert.equal(f.remaining.kind, 'voided');
  assert.equal(f.remaining.amount, 7_800_000);
  assert.equal(f.installmentsSummary, '2 أقساط — من 1,000,000 إلى 4,400,000 ل.س');
  assert.equal(f.mismatch?.kind, 'schedule');
  assert.equal(
    installmentDisplayStatus({ dueDate: '2026-07-04', amountSyp: 4_400_000, remainingBalance: 4_400_000 }, 'cancelled', TODAY),
    'voided',
  );
});

test('USD-linked schedule: one remaining figure, at today\'s due, and down payment from signing entries', () => {
  // C-2026-00059: down_payment column 0, signing entries 12M, 3 USD-linked installments
  const f = computeContractFinance({
    status: 'active', paymentType: 'installment', finalPrice: 20_021_300, basePrice: 20_000_000,
    downPayment: 0,
    paymentEntries: [
      { amountSyp: 10_000_000, installmentId: null },
      { amountSyp: 2_000_000, installmentId: null },
      { amountSyp: 2_250_013, installmentId: 73551 },
    ],
    installments: [
      { dueDate: '2026-12-13', amountSyp: 2_673_766, paidAmount: 2_250_013, remainingBalance: 423_753, usdDue: { dueTodaySyp: 396_000 } },
      { dueDate: '2027-01-13', amountSyp: 2_673_766, paidAmount: 0, remainingBalance: 2_673_766, usdDue: { dueTodaySyp: 2_496_000 } },
      { dueDate: '2027-02-13', amountSyp: 2_673_768, paidAmount: 0, remainingBalance: 2_673_768, usdDue: { dueTodaySyp: 2_496_000 } },
    ],
  }, TODAY);
  assert.equal(f.downPaymentShown, 12_000_000);
  assert.deepEqual(f.remaining, { kind: 'live', amount: 5_388_000 });
  assert.equal(f.extras, 21_300);
  assert.equal(f.installmentsSummary, '3 × 2,673,766 ل.س');
  assert.equal(f.mismatch, null);
});

test('a partially paid installment past its due date is overdue', () => {
  assert.equal(
    installmentDisplayStatus({ dueDate: '2026-10-01', amountSyp: 100, paidAmount: 40, remainingBalance: 60, status: 'partial' }, 'active', TODAY),
    'overdue',
  );
  assert.equal(
    installmentDisplayStatus({ dueDate: '2026-12-01', amountSyp: 100, paidAmount: 40, remainingBalance: 60, status: 'partial' }, 'active', TODAY),
    'partial',
  );
});

test('a draft schedule is planned, not a debt', () => {
  const f = computeContractFinance({
    status: 'draft', paymentType: 'installment', finalPrice: 175_000, basePrice: 175_000,
    paymentEntries: [{ amountSyp: 144_000, installmentId: null }],
    installments: [{ dueDate: '2026-12-13', amountSyp: 10_333, remainingBalance: 10_333 }],
  }, TODAY);
  assert.equal(f.remaining.kind, 'planned');
  assert.equal(installmentDisplayStatus({ dueDate: '2026-01-01', amountSyp: 1, remainingBalance: 1 }, 'draft', TODAY), 'planned');
});

test('a completed contract whose recorded numbers leave a balance is flagged', () => {
  // migrated: price 251,000, down 126,000, installments 75,000 (all paid)
  const f = computeContractFinance({
    status: 'completed', paymentType: 'installment', finalPrice: 251_000, basePrice: 251_000,
    downPayment: 126_000,
    paymentEntries: [
      { amountSyp: 126_000, installmentId: null },
      { amountSyp: 75_000, installmentId: 1 },
    ],
    installments: [{ dueDate: '2026-01-01', amountSyp: 75_000, paidAmount: 75_000, remainingBalance: 0 }],
  }, TODAY);
  assert.ok(f.mismatch);
  assert.equal(f.remaining.amount, 50_000);
});
