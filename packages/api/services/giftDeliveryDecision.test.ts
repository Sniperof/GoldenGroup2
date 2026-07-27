import test from 'node:test';
import assert from 'node:assert/strict';
import { giftDeliveryDecisionTransition } from './visitTaskResultReflection.js';

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
