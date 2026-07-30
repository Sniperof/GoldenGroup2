import test from 'node:test';
import assert from 'node:assert/strict';
import {
  giftDeliveryDecisionTransition,
  INSERT_GIFT_DELIVERY_RESULT_EVENTS_SQL,
  insertGiftDeliveryResultEvents,
} from './visitTaskResultReflection.js';

test('gift delivery exposes exactly the three whole-bundle result transitions', () => {
  assert.deepEqual(giftDeliveryDecisionTransition('delivered_successfully'), {
    giftStatus: 'delivered',
    openTaskStatus: 'completed',
  });
  assert.deepEqual(giftDeliveryDecisionTransition('refused_gift'), {
    giftStatus: 'refused',
    openTaskStatus: 'cancelled',
  });
  assert.deepEqual(giftDeliveryDecisionTransition('rescheduled'), {
    giftStatus: 'delivery_task_created',
    openTaskStatus: 'needs_follow_up',
  });
  assert.equal(
    ['delivered_successfully', 'refused_gift', 'rescheduled'].includes('partial_delivery'),
    false,
  );
});

test('gift delivery result event explicitly types every polymorphic JSON bind parameter', async () => {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      return { rows: [], rowCount: 2 };
    },
  } as any;

  await insertGiftDeliveryResultEvents(db, {
    visitTaskId: 71,
    visitTaskResultId: 83,
    performedByUserId: 4,
    newGiftStatus: 'delivered',
    closingNotes: 'تم التسليم',
    decision: 'delivered_successfully',
    giftRecordIds: [11, 12],
    previousGiftStatuses: ['delivery_task_created', 'delivery_task_created'],
  });

  assert.match(INSERT_GIFT_DELIVERY_RESULT_EVENTS_SQL, /'visitTaskId', \$1::bigint/);
  assert.match(INSERT_GIFT_DELIVERY_RESULT_EVENTS_SQL, /'visitTaskResultId', \$2::bigint/);
  assert.match(INSERT_GIFT_DELIVERY_RESULT_EVENTS_SQL, /'finalDecision', \$6::text/);
  assert.deepEqual(statements, [{
    sql: INSERT_GIFT_DELIVERY_RESULT_EVENTS_SQL,
    params: [
      71,
      83,
      4,
      'delivered',
      'تم التسليم',
      'delivered_successfully',
      [11, 12],
      ['delivery_task_created', 'delivery_task_created'],
    ],
  }]);
});
