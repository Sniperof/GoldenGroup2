import assert from 'node:assert/strict';
import test from 'node:test';
import { notifyServiceRequestStatusChanged, notifyWarrantyActivated } from './notify.js';
import type { Queryable } from './notificationService.js';

function mockDb(opts: { recipients?: unknown[]; deviceOwner?: number | null; failOn?: string } = {}) {
  const inserts: unknown[][] = [];
  const db: Queryable = {
    async query(sql: string, params?: unknown[]) {
      if (opts.failOn && sql.includes(opts.failOn)) throw new Error('database is on fire');
      if (sql.includes('system_settings')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM installed_devices')) {
        return opts.deviceOwner == null
          ? { rows: [], rowCount: 0 }
          : { rows: [{ customer_id: opts.deviceOwner }], rowCount: 1 };
      }
      if (sql.includes('FROM app_accounts')) {
        const rows = opts.recipients ?? [{ app_account_id: '7', locale: 'ar', tokens: ['tok'] }];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('INSERT INTO app_notifications')) {
        inserts.push(params ?? []);
        return { rows: [{ id: '1' }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { db, inserts };
}

test('the four terminal statuses notify', async () => {
  for (const status of ['promoted', 'completed', 'rejected', 'cancelled']) {
    const { db, inserts } = mockDb();
    const out = await notifyServiceRequestStatusChanged(db, {
      serviceRequestId: 5, clientId: 3, requestType: 'emergency_maintenance', status,
    });
    assert.equal(out.length, 1, `${status} should notify`);
    assert.equal(inserts.length, 1);
  }
});

test('intermediate and reopen-target statuses do not notify', async () => {
  for (const status of ['received', 'in_review', 'resolved_at_intake', 'awaiting_customer_info']) {
    const { db, inserts } = mockDb();
    const out = await notifyServiceRequestStatusChanged(db, {
      serviceRequestId: 5, clientId: 3, requestType: 'emergency_maintenance', status,
    });
    assert.deepEqual(out, [], `${status} must stay silent`);
    assert.equal(inserts.length, 0);
  }
});

test('account_creation is excluded — its result cannot reach an unregistered device (D-N3)', async () => {
  const { db, inserts } = mockDb();
  const out = await notifyServiceRequestStatusChanged(db, {
    serviceRequestId: 5, clientId: 3, requestType: 'account_creation', status: 'completed',
  });
  assert.deepEqual(out, []);
  assert.equal(inserts.length, 0);
});

test('a request with no linked client is a silent no-op, not an error', async () => {
  const { db, inserts } = mockDb();
  const out = await notifyServiceRequestStatusChanged(db, {
    serviceRequestId: 5, clientId: null, requestType: 'water_check', status: 'completed',
  });
  assert.deepEqual(out, []);
  assert.equal(inserts.length, 0);
});

test('the request id is carried without pointing the app at a screen', async () => {
  const { db, inserts } = mockDb();
  const [push] = await notifyServiceRequestStatusChanged(db, {
    serviceRequestId: 123, clientId: 3, requestType: 'water_check', status: 'promoted',
  });
  const data = JSON.parse(String(inserts[0][5]));
  // The id is preserved for when a request-details screen exists...
  assert.equal(data.service_request_id, '123');
  // ...but no destination is sent, because the app's service_request route is
  // the intake form and would fail on a raw id.
  assert.equal(data.destination, undefined);
  assert.equal(push.data.destination, undefined);
});

test('a database failure is swallowed — an operation is never rolled back by a notification', async () => {
  const { db } = mockDb({ failOn: 'INSERT INTO app_notifications' });
  const out = await notifyServiceRequestStatusChanged(db, {
    serviceRequestId: 5, clientId: 3, requestType: 'water_check', status: 'completed',
  });
  assert.deepEqual(out, [], 'returns empty instead of throwing');
});

test('warranty activation resolves the recipient from the device', async () => {
  const { db, inserts } = mockDb({ deviceOwner: 44 });
  const [push] = await notifyWarrantyActivated(db, { deviceId: 9 });
  assert.equal(inserts[0][1], 'warranty_activated');
  assert.equal(push.data.destination, 'warranty');
});

test('a device with no owner notifies nobody', async () => {
  const { db, inserts } = mockDb({ deviceOwner: null });
  const out = await notifyWarrantyActivated(db, { deviceId: 9 });
  assert.deepEqual(out, []);
  assert.equal(inserts.length, 0);
});

test('a failing device lookup is swallowed too', async () => {
  const { db } = mockDb({ failOn: 'FROM installed_devices' });
  assert.deepEqual(await notifyWarrantyActivated(db, { deviceId: 9 }), []);
});
