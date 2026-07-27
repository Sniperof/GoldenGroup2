import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenTaskCancellationError,
  cancelLockedOpenTaskBeforeScheduling,
  resolveOpenTaskCancellationReason,
} from './openTaskCancellation.js';

function fakeDb(rowsByQuery: (sql: string) => any[]) {
  const statements: Array<{ sql: string; params: any[] }> = [];
  return {
    statements,
    db: {
      async query(sql: string, params: any[] = []) {
        statements.push({ sql, params });
        return { rows: rowsByQuery(sql) };
      },
    } as any,
  };
}

test('gift task cancellation uses its own category and restores the linked gift bundle', async () => {
  const { db, statements } = fakeDb((sql) => {
    if (sql.includes('FROM system_lists')) {
      return [{
        id: 41,
        category: 'gift_delivery_task_cancellation_reasons',
        value: 'data_correction',
        metadata: { label: 'تصحيح بيانات' },
      }];
    }
    return [];
  });

  const reason = await cancelLockedOpenTaskBeforeScheduling(
    db,
    {
      id: 9,
      branchId: 2,
      taskType: 'gift_delivery',
      status: 'open',
      hasActiveVisit: false,
    },
    41,
    7,
    'branch_manager',
  );

  assert.equal(reason.category, 'gift_delivery_task_cancellation_reasons');
  assert.equal(reason.label, 'تصحيح بيانات');
  assert.equal(statements.some(({ sql }) => sql.includes("status = 'cancelled'")), true);
  const giftUpdate = statements.find(({ sql }) => sql.includes('UPDATE gift_records'));
  assert.ok(giftUpdate);
  assert.match(giftUpdate.sql, /status = 'approved_for_delivery'/);
  assert.match(giftUpdate.sql, /gift_delivery_task_records/);
  assert.match(giftUpdate.sql, /is_active = FALSE/);
  assert.deepEqual(giftUpdate.params, [9, 'تصحيح بيانات', 7]);
  assert.equal(statements.some(({ sql }) => sql.includes('task_activity_log')), true);
});

test('scheduled or actively booked tasks cannot use direct cancellation', async () => {
  const { db, statements } = fakeDb(() => []);
  await assert.rejects(
    () => cancelLockedOpenTaskBeforeScheduling(
      db,
      {
        id: 10,
        branchId: 2,
        taskType: 'device_return',
        status: 'scheduled',
        hasActiveVisit: true,
      },
      1,
      7,
      null,
    ),
    (error: any) => error instanceof OpenTaskCancellationError && error.status === 409,
  );
  assert.equal(statements.length, 0);
});

test('a reason from another category is rejected', async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    () => resolveOpenTaskCancellationReason(db, 'device_return', 99),
    (error: any) => error instanceof OpenTaskCancellationError && error.status === 400,
  );
});
