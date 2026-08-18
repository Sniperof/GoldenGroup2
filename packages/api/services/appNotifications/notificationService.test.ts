import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotifications, type Queryable } from './notificationService.js';
import { buildNotificationText } from './notificationCatalog.js';

// Routes queries by SQL shape (same convention as accountDuplicatePolicy.test).
// What matters here is the payload the service composes, so the mock records
// every INSERT and hands back ids.
function mockDb(
  recipients: { app_account_id: string; locale: string | null; tokens: string[] }[],
  opts: { enabledValue?: string | null; dedupeHits?: number } = {},
) {
  const inserts: unknown[][] = [];
  let nextId = 100;
  let remainingDedupeHits = opts.dedupeHits ?? 0;
  const db: Queryable = {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('system_settings')) {
        return opts.enabledValue === undefined
          ? { rows: [], rowCount: 0 }
          : { rows: [{ value: opts.enabledValue }], rowCount: 1 };
      }
      if (sql.includes('FROM app_accounts')) return { rows: recipients, rowCount: recipients.length };
      if (sql.includes('INSERT INTO app_notifications')) {
        inserts.push(params ?? []);
        // Simulate the partial unique index swallowing a repeat.
        if (remainingDedupeHits > 0) {
          remainingDedupeHits -= 1;
          return { rows: [], rowCount: 0 };
        }
        return { rows: [{ id: String(nextId++) }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { db, inserts };
}

const ONE_ACCOUNT = [{ app_account_id: '7', locale: 'ar', tokens: ['tok-a'] }];

test('builds one row per active account of the client (D-N12 fan-out)', async () => {
  const { db, inserts } = mockDb([
    { app_account_id: '7', locale: 'ar', tokens: ['tok-a'] },
    { app_account_id: '8', locale: 'en', tokens: ['tok-b', 'tok-c'] },
  ]);
  const out = await createNotifications({
    type: 'service_request_status_changed',
    clientId: 42,
    destinationId: 123,
    vars: { requestId: 123, status: 'completed' },
    db,
  });

  assert.equal(inserts.length, 2);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((p) => p.appAccountId), [7, 8]);
  assert.deepEqual(out[1].tokens, ['tok-b', 'tok-c']);
});

test('the stored data map and the push data map agree (§E.2)', async () => {
  const { db, inserts } = mockDb(ONE_ACCOUNT);
  const [push] = await createNotifications({
    type: 'service_request_status_changed',
    clientId: 42,
    destinationId: 123,
    vars: { requestId: 123, status: 'promoted' },
    db,
  });

  const storedData = JSON.parse(String(inserts[0][5]));
  assert.deepEqual(storedData, {
    type: 'service_request_status_changed',
    destination: 'service_request',
    destination_id: '123',
  });
  // The push adds notification_id and changes nothing else.
  assert.deepEqual(push.data, { ...storedData, notification_id: push.notificationId });
});

test('destination_id is serialized as a string even when given a number', async () => {
  const { db, inserts } = mockDb(ONE_ACCOUNT);
  await createNotifications({
    type: 'maintenance_due',
    clientId: 42,
    destinationId: 42,
    entityId: 42,
    windowKey: '2026-08-17',
    vars: { deviceLabel: 'فلتر المطبخ' },
    db,
  });
  assert.equal(JSON.parse(String(inserts[0][5])).destination_id, '42');
});

test('the type column mirrors data.type, which the DB check constraint requires', async () => {
  const { db, inserts } = mockDb(ONE_ACCOUNT);
  await createNotifications({
    type: 'warranty_activated',
    clientId: 42,
    vars: {},
    db,
  });
  assert.equal(inserts[0][1], JSON.parse(String(inserts[0][5])).type);
});

test('language follows the recipient, not the caller (D-N13)', async () => {
  const { db } = mockDb([
    { app_account_id: '7', locale: 'ar', tokens: [] },
    { app_account_id: '8', locale: 'en', tokens: [] },
  ]);
  const out = await createNotifications({
    type: 'visit_scheduled',
    clientId: 42,
    destinationId: 55,
    vars: { date: '2026-08-23' },
    db,
  });
  assert.equal(out[0].locale, 'ar');
  assert.equal(out[1].locale, 'en');
  assert.match(out[1].body, /^Your visit is scheduled/);
});

test('an unknown or missing registration locale falls back to Arabic', async () => {
  const { db } = mockDb([{ app_account_id: '7', locale: null, tokens: [] }]);
  const [push] = await createNotifications({
    type: 'warranty_activated', clientId: 42, vars: {}, db,
  });
  assert.equal(push.locale, 'ar');
});

test('a customer with no app account is a silent no-op (D-N8)', async () => {
  const { db, inserts } = mockDb([]);
  const out = await createNotifications({
    type: 'warranty_activated', clientId: 999, vars: {}, db,
  });
  assert.deepEqual(out, []);
  assert.equal(inserts.length, 0);
});

test('a disabled type writes nothing (D-N5 kill switch)', async () => {
  const { db, inserts } = mockDb(ONE_ACCOUNT, { enabledValue: 'false' });
  const out = await createNotifications({
    type: 'warranty_activated', clientId: 42, vars: {}, db,
  });
  assert.deepEqual(out, []);
  assert.equal(inserts.length, 0);
});

test('an unset toggle means enabled, so a new type is not born dead', async () => {
  const { db } = mockDb(ONE_ACCOUNT, { enabledValue: undefined });
  const out = await createNotifications({
    type: 'warranty_activated', clientId: 42, vars: {}, db,
  });
  assert.equal(out.length, 1);
});

test('a deduped insert produces no push — the existing row is the record', async () => {
  const { db, inserts } = mockDb(ONE_ACCOUNT, { dedupeHits: 1 });
  const out = await createNotifications({
    type: 'visit_reminder',
    clientId: 42,
    destinationId: 55,
    entityId: 55,
    windowKey: '2026-08-17',
    vars: { timeLabel: '09:00' },
    db,
  });
  assert.equal(inserts.length, 1, 'the insert is still attempted');
  assert.deepEqual(out, [], 'but nothing is queued for push');
});

test('a scheduled type without dedup coordinates is rejected, not sent daily forever', async () => {
  const { db } = mockDb(ONE_ACCOUNT);
  await assert.rejects(
    () => createNotifications({
      type: 'maintenance_due', clientId: 42, vars: { deviceLabel: null }, db,
    }),
    /requires entityId \+ windowKey/,
  );
});

test('free-form sends carry the admin author and their own text (D-N6)', async () => {
  const { db, inserts } = mockDb(ONE_ACCOUNT);
  const [push] = await createNotifications({
    type: 'general',
    clientId: 42,
    vars: { title: 'انقطاع خدمة', message: 'نعتذر عن انقطاع الخدمة في منطقتكم اليوم' },
    createdByUserId: 5,
    db,
  });
  assert.equal(push.title, 'انقطاع خدمة');
  assert.equal(inserts[0][8], 5, 'created_by is the admin');
  // No destination was chosen, so the payload carries type only and the app
  // falls back to the notifications list.
  assert.deepEqual(JSON.parse(String(inserts[0][5])), { type: 'general' });
});

test('extra data keys survive into both maps without displacing the contract keys', async () => {
  const { db, inserts } = mockDb(ONE_ACCOUNT);
  const [push] = await createNotifications({
    type: 'visit_cancelled',
    clientId: 42,
    destinationId: 55,
    extraData: { reason_code: 'weather', type: 'spoofed' },
    vars: { date: '2026-08-23' },
    db,
  });
  const stored = JSON.parse(String(inserts[0][5]));
  assert.equal(stored.reason_code, 'weather');
  assert.equal(stored.type, 'visit_cancelled', 'extraData cannot override the type');
  assert.equal(push.data.reason_code, 'weather');
});

test('Arabic day agreement changes across the two default warranty windows', () => {
  assert.match(buildNotificationText('warranty_expiring', 'ar', { daysLeft: 30 }).message, /30 يوماً/);
  assert.match(buildNotificationText('warranty_expiring', 'ar', { daysLeft: 7 }).message, /7 أيام/);
  assert.match(buildNotificationText('warranty_expiring', 'ar', { daysLeft: 1 }).message, /يوم واحد/);
});
