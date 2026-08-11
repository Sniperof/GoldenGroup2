import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEVICE_POSSESSION_FROM,
  DEVICE_POSSESSION_SELECT,
  mapDevicePossessionRow,
} from './devicePossessionProjection.js';

test('possession projection resolves every currently-backed holder type', () => {
  assert.match(DEVICE_POSSESSION_FROM, /LEFT JOIN clients holder_customer/);
  assert.match(DEVICE_POSSESSION_FROM, /LEFT JOIN employees holder_technician/);
  assert.match(DEVICE_POSSESSION_FROM, /LEFT JOIN branches holder_workshop/);
  assert.match(DEVICE_POSSESSION_SELECT, /END AS holder_name/);
});

test('possession row mapping exposes the resolved holder name', () => {
  assert.deepEqual(
    mapDevicePossessionRow({
      id: 14,
      device_id: 32,
      holder_type: 'customer',
      holder_id: 30,
      holder_name: 'هادي صقر',
      start_at: '2026-07-22T16:42:05.000Z',
      end_at: null,
      reason: 'external_registration',
      notes: null,
      created_by: 7,
      created_at: '2026-07-22T16:42:05.000Z',
    }),
    {
      id: 14,
      deviceId: 32,
      holderType: 'customer',
      holderId: 30,
      holderName: 'هادي صقر',
      startAt: '2026-07-22T16:42:05.000Z',
      endAt: null,
      reason: 'external_registration',
      notes: null,
      createdBy: 7,
      createdAt: '2026-07-22T16:42:05.000Z',
    },
  );
});
