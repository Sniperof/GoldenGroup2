import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSnapshotAddress,
  resolveBookingAddress,
  withResolvedBookingAddress,
} from './telemarketingAppointmentSnapshot';

test('reads both flat and structured customer snapshot addresses', () => {
  assert.equal(getSnapshotAddress({ addressText: 'المزة، بناء 4' }), 'المزة، بناء 4');
  assert.equal(getSnapshotAddress({ address: { detailedAddress: 'جرمانا، شارع البلدية' } }), 'جرمانا، شارع البلدية');
});

test('booking address prefers the frozen task location over client fallbacks', () => {
  assert.equal(resolveBookingAddress({
    taskListAddress: 'عنوان الجهاز المثبت',
    taskLocationAddress: 'عنوان مهمة بديل',
    suppliedSnapshot: { addressText: 'عنوان مرسل من الواجهة' },
    customerAddress: 'عنوان الزبون العام',
  }), 'عنوان الجهاز المثبت');
});

test('resolved address is written as a flat compatibility field without losing snapshot data', () => {
  assert.deepEqual(withResolvedBookingAddress({ name: 'سماح' }, 'عين ترما'), {
    name: 'سماح',
    addressText: 'عين ترما',
  });
});
