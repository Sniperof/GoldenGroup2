import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TASK_CANCELLATION_REASON_CATEGORIES,
  VISIT_RESULT_TASK_TYPES,
  canCancelOpenTaskBeforeScheduling,
  getTaskCancellationReasonCategory,
} from './taskResultPolicy.js';

test('every visit-result task has a cancellation reason category', () => {
  assert.deepEqual(
    Object.keys(TASK_CANCELLATION_REASON_CATEGORIES).sort(),
    [...VISIT_RESULT_TASK_TYPES].sort(),
  );
  assert.equal(getTaskCancellationReasonCategory('gift_delivery'), 'gift_delivery_task_cancellation_reasons');
  assert.equal(getTaskCancellationReasonCategory('device_return'), 'device_return_refusal_reasons');
});

test('unknown legacy task types use the general visit cancellation list', () => {
  assert.equal(getTaskCancellationReasonCategory('legacy_task'), 'visit_cancellation_reasons');
});

test('only tasks that have not entered scheduling can be cancelled directly', () => {
  for (const status of ['open', 'needs_follow_up', 'assigned', 'in_scheduling']) {
    assert.equal(canCancelOpenTaskBeforeScheduling(status, false), true, status);
  }
  for (const status of ['scheduled', 'waiting_execution', 'in_execution', 'ended', 'completed', 'closed', 'cancelled']) {
    assert.equal(canCancelOpenTaskBeforeScheduling(status, false), false, status);
  }
  assert.equal(canCancelOpenTaskBeforeScheduling('open', true), false);
});
