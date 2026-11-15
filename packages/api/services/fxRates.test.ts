import assert from 'node:assert/strict';
import test from 'node:test';
import { computeUsdDue, fullPaymentBounds, usdFromSyp } from '@golden-crm/shared';
import { planUsdCollection } from './fxRates';

test('computeUsdDue rounds to the nearest unit and never drops a live USD balance to zero', () => {
  assert.deepEqual(computeUsdDue({ remainingUsd: 115.38, dayRate: 15000, roundingUnit: 1000 }), { rawSyp: 1730700, dueTodaySyp: 1731000 });
  assert.equal(computeUsdDue({ remainingUsd: 1.53, dayRate: 14400, roundingUnit: 1000 }).dueTodaySyp, 22000);
  // 0.02 $ × 15,000 = 300 → nearest 1,000 is 0, but USD is still owed → one unit.
  assert.equal(computeUsdDue({ remainingUsd: 0.02, dayRate: 15000, roundingUnit: 1000 }).dueTodaySyp, 1000);
  // unit 0 → whole SYP
  assert.equal(computeUsdDue({ remainingUsd: 1.53, dayRate: 14400, roundingUnit: 0 }).dueTodaySyp, 22032);
  assert.equal(computeUsdDue({ remainingUsd: 0, dayRate: 15000, roundingUnit: 1000 }).dueTodaySyp, 0);
});

test('fullPaymentBounds spans the exact and the rounded due', () => {
  assert.deepEqual(fullPaymentBounds({ rawSyp: 1730700, dueTodaySyp: 1731000 }), { lower: 1730700, upper: 1731000 });
  assert.deepEqual(fullPaymentBounds({ rawSyp: 22032, dueTodaySyp: 22000 }), { lower: 22000, upper: 22032 });
});

test('full payment: accepted inside the bounds, rejected above, credits exactly the remaining SYP', () => {
  const base = { remainingUsd: 115.38, remainingBalance: 1500000, contractRate: 13000, dayRate: 15000, roundingUnit: 1000 } as const;
  const above = planUsdCollection({ ...base, decision: 'paid_full', parts: [{ collectedSyp: 1732000, usdFace: null }] });
  assert.equal(above.ok, false);
  const below = planUsdCollection({ ...base, decision: 'paid_full', parts: [{ collectedSyp: 1729000, usdFace: null }] });
  assert.equal(below.ok, false);
  const ok = planUsdCollection({ ...base, decision: 'paid_full', parts: [{ collectedSyp: 1731000, usdFace: null }] });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.plan.creditedSyp, 1500000);
    assert.equal(ok.plan.usdSettled, 115.38);
    assert.equal(ok.plan.differenceSyp, 231000);
    assert.equal(ok.plan.dustClosed, false);
  }
  // USD cash only at face value: exact (unrounded) amount is a full payment.
  const usdOnly = planUsdCollection({ ...base, decision: 'paid_full', parts: [{ collectedSyp: 115.38 * 15000, usdFace: 115.38 }] });
  assert.equal(usdOnly.ok, true);
});

test('cash-share split: 1 $ + 7,600 SYP at an unchanged rate credits exactly what was paid per part', () => {
  const amountUsd = usdFromSyp(22000, 14400); // 1.53
  const r = planUsdCollection({
    decision: 'paid_full',
    parts: [{ collectedSyp: 14400, usdFace: 1 }, { collectedSyp: 7600, usdFace: null }],
    remainingUsd: amountUsd, remainingBalance: 22000, contractRate: 14400, dayRate: 14400, roundingUnit: 1000,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.plan.parts.map((p) => p.creditedSyp), [14400, 7600]);
    assert.equal(r.plan.parts[0].usdSettled, 1);
    assert.equal(r.plan.parts.reduce((s, p) => s + p.usdSettled, 0).toFixed(6), amountUsd.toFixed(6));
    assert.equal(r.plan.differenceSyp, 0);
  }
});

test('partial payment credits USD × contract rate in whole SYP and must stay below the due', () => {
  const base = { remainingUsd: 115.38, remainingBalance: 1500000, contractRate: 13000, dayRate: 15000, roundingUnit: 1000 } as const;
  const r = planUsdCollection({ ...base, decision: 'paid_partial', parts: [{ collectedSyp: 700000, usdFace: null }] });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(Number.isInteger(r.plan.creditedSyp), true);
    assert.equal(r.plan.creditedSyp, Math.round(46.67 * 13000)); // USD settled (cents) × contract rate
    assert.equal(r.plan.dustClosed, false);
  }
  const tooMuch = planUsdCollection({ ...base, decision: 'paid_partial', parts: [{ collectedSyp: 1730700, usdFace: null }] });
  assert.equal(tooMuch.ok, false);
});

test('D8 dust: a partial payment leaving < half a unit closes the installment at its original SYP', () => {
  // remaining 10 $ at 15,000 → raw 150,000. Paying 149,600 leaves 400 SYP-equivalent (< 500).
  const r = planUsdCollection({
    decision: 'paid_partial',
    parts: [{ collectedSyp: 149600, usdFace: null }],
    remainingUsd: 10, remainingBalance: 130000, contractRate: 13000, dayRate: 15000, roundingUnit: 1000,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.plan.dustClosed, true);
    assert.equal(r.plan.creditedSyp, 130000);
    assert.equal(r.plan.usdSettled, 10);
    assert.equal(r.plan.differenceSyp, 149600 - 130000);
  }
  // 600 SYP-equivalent left (≥ 500) → stays a normal partial.
  const normal = planUsdCollection({
    decision: 'paid_partial',
    parts: [{ collectedSyp: 149400, usdFace: null }],
    remainingUsd: 10, remainingBalance: 130000, contractRate: 13000, dayRate: 15000, roundingUnit: 1000,
  });
  assert.equal(normal.ok, true);
  if (normal.ok) assert.equal(normal.plan.dustClosed, false);
});

test('owner case (task 60542): 150 $ cash on a 178.25 $ installment credits 150 × contract rate', () => {
  const r = planUsdCollection({
    decision: 'paid_partial',
    parts: [{ collectedSyp: 150 * 14000, usdFace: 150 }],
    remainingUsd: 178.25, remainingBalance: 2673766, contractRate: 15000, dayRate: 14000, roundingUnit: 1000,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.plan.usdSettled, 150);
    assert.equal(r.plan.creditedSyp, 2250000);
    assert.equal(r.plan.differenceSyp, 2100000 - 2250000);
  }
  // Closing payment absorbs the cent residue: 28.25 $ left, 423,766 SYP left.
  const close = planUsdCollection({
    decision: 'paid_full',
    parts: [{ collectedSyp: 28.25 * 14000, usdFace: 28.25 }],
    remainingUsd: 28.25, remainingBalance: 423766, contractRate: 15000, dayRate: 14000, roundingUnit: 1000,
  });
  assert.equal(close.ok, true);
  if (close.ok) assert.equal(close.plan.creditedSyp, 423766);
});
