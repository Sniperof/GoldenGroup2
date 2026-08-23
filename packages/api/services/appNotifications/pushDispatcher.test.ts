import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchPreparedPushes } from './pushDispatcher.js';
import { NoopPushSender, maskToken, type PushMessage, type PushSendResult, type PushSender } from './pushSender.js';
import type { PreparedPush, Queryable } from './notificationService.js';

function push(overrides: Partial<PreparedPush> = {}): PreparedPush {
  return {
    notificationId: '1',
    appAccountId: 7,
    locale: 'ar',
    tokens: ['tok-a'],
    title: 'عنوان',
    body: 'نص',
    data: { type: 'warranty_activated', notification_id: '1' },
    ...overrides,
  };
}

function mockDb() {
  const queries: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params: params ?? [] });
      return { rows: [], rowCount: sql.includes('DELETE') ? 2 : 1 };
    },
  };
  return { db, queries };
}

class StubSender implements PushSender {
  readonly name = 'stub';
  readonly seen: PushMessage[] = [];
  constructor(private readonly result: Partial<PushSendResult> = {}) {}
  async send(message: PushMessage): Promise<PushSendResult> {
    this.seen.push(message);
    return {
      provider: this.name,
      sent: message.tokens.length,
      failed: 0,
      invalidTokens: [],
      ...this.result,
    };
  }
}

class ThrowingSender implements PushSender {
  readonly name = 'throwing';
  async send(): Promise<PushSendResult> {
    throw new Error('network is down');
  }
}

test('stamps sent_at once delivery succeeded', async () => {
  const { db, queries } = mockDb();
  const summary = await dispatchPreparedPushes([push()], { db, sender: new StubSender() });

  assert.deepEqual(summary, { attempted: 1, sent: 1, failed: 0, purgedTokens: 0 });
  const update = queries.find((q) => q.sql.includes('SET sent_at'));
  assert.ok(update, 'sent_at is stamped');
  assert.deepEqual(update.params, ['1']);
  assert.match(update.sql, /sent_at IS NULL/, 'a re-dispatch must not move the original timestamp');
});

test('a notification with no registered device is skipped, not counted as failed', async () => {
  const { db, queries } = mockDb();
  const sender = new StubSender();
  const summary = await dispatchPreparedPushes([push({ tokens: [] })], { db, sender });

  assert.deepEqual(summary, { attempted: 0, sent: 0, failed: 0, purgedTokens: 0 });
  assert.equal(sender.seen.length, 0, 'the provider is not called at all');
  assert.equal(queries.length, 0, 'and sent_at stays NULL — no push was sent');
});

test('dead tokens reported by the provider are deleted', async () => {
  const { db, queries } = mockDb();
  const sender = new StubSender({ sent: 0, failed: 1, invalidTokens: ['tok-a'] });
  const summary = await dispatchPreparedPushes([push()], { db, sender });

  const del = queries.find((q) => q.sql.includes('DELETE FROM app_notification_registrations'));
  assert.ok(del, 'the registration is purged');
  assert.deepEqual(del.params, [['tok-a']]);
  assert.equal(summary.purgedTokens, 2);
  assert.equal(queries.some((q) => q.sql.includes('SET sent_at')), false, 'nothing was delivered');
});

test('a provider that throws does not stop the rest of the batch', async () => {
  const { db } = mockDb();
  const summary = await dispatchPreparedPushes(
    [push({ notificationId: '1' }), push({ notificationId: '2' })],
    { db, sender: new ThrowingSender() },
  );
  assert.equal(summary.attempted, 2, 'both were attempted despite the first throwing');
  assert.equal(summary.sent, 0);
  assert.equal(summary.failed, 2);
});

test('dispatching nothing touches neither the DB nor the provider', async () => {
  const { db, queries } = mockDb();
  const summary = await dispatchPreparedPushes([], { db, sender: new StubSender() });
  assert.deepEqual(summary, { attempted: 0, sent: 0, failed: 0, purgedTokens: 0 });
  assert.equal(queries.length, 0);
});

test('the message handed to the provider is exactly what was prepared', async () => {
  const { db } = mockDb();
  const sender = new StubSender();
  await dispatchPreparedPushes([push()], { db, sender });

  assert.deepEqual(sender.seen[0], {
    tokens: ['tok-a'],
    title: 'عنوان',
    body: 'نص',
    data: { type: 'warranty_activated', notification_id: '1' },
  });
});

test('the noop provider reports every device as delivered without contacting anything', async () => {
  const result = await new NoopPushSender().send({
    tokens: ['a', 'b'], title: 't', body: 'b', data: { type: 'general' },
  });
  assert.deepEqual(result, { provider: 'noop', sent: 2, failed: 0, invalidTokens: [] });
});

test('token masking never reveals a whole registration token', () => {
  const token = 'abcdefghijklmnopqrstuvwxyz';
  const masked = maskToken(token);
  assert.equal(masked.includes(token), false);
  assert.equal(maskToken('short'), '***');
});
