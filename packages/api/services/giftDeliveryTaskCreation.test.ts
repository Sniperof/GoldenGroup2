import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GiftDeliveryTaskCreationError,
  INSERT_GIFT_DELIVERY_LINK_EVENTS_SQL,
  insertGiftDeliveryLinkedEvents,
  mapGiftDeliveryCreationDatabaseError,
} from './giftDeliveryTaskCreation.js';

test('gift delivery event insert gives the polymorphic JSON value an explicit PostgreSQL type', async () => {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      return { rows: [], rowCount: 2 };
    },
  } as any;

  await insertGiftDeliveryLinkedEvents(db, [11, 12], 27, 4);

  assert.match(INSERT_GIFT_DELIVERY_LINK_EVENTS_SQL, /jsonb_build_object\('openTaskId', \$2::integer\)/);
  assert.deepEqual(statements, [{
    sql: INSERT_GIFT_DELIVERY_LINK_EVENTS_SQL,
    params: [[11, 12], 27, 4],
  }]);
});

test('active gift-record link uniqueness is returned as a stable conflict', () => {
  const mapped = mapGiftDeliveryCreationDatabaseError({
    code: '23505',
    constraint: 'uq_gift_delivery_task_records_active_record',
  });

  assert.ok(mapped instanceof GiftDeliveryTaskCreationError);
  assert.equal(mapped.status, 409);
  assert.equal(mapped.code, 'GIFT_DELIVERY_TASK_ALREADY_ACTIVE');
});

test('legacy client-level uniqueness is returned as a stable conflict', () => {
  const mapped = mapGiftDeliveryCreationDatabaseError({
    code: '23505',
    constraint: 'idx_open_tasks_unique_active_per_client',
  });

  assert.ok(mapped instanceof GiftDeliveryTaskCreationError);
  assert.equal(mapped.status, 409);
  assert.equal(mapped.code, 'GIFT_DELIVERY_CLIENT_TASK_CONFLICT');
});

test('unrelated database errors are not hidden as gift delivery conflicts', () => {
  assert.equal(mapGiftDeliveryCreationDatabaseError({ code: '23503' }), null);
  assert.equal(mapGiftDeliveryCreationDatabaseError(new Error('boom')), null);
});
