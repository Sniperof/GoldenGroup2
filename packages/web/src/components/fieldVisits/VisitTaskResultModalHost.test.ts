import assert from 'node:assert/strict';
import test from 'node:test';
import { VISIT_RESULT_TASK_TYPES } from '@golden-crm/shared';
import {
  VISIT_TASK_RESULT_MODAL_REGISTRY,
  hasVisitTaskResultModal,
} from './VisitTaskResultModalHost.js';

test('visit result registry covers every canonical result task type', () => {
  assert.deepEqual(
    Object.keys(VISIT_TASK_RESULT_MODAL_REGISTRY).sort(),
    [...VISIT_RESULT_TASK_TYPES].sort(),
  );
});

test('gift delivery is recordable from the visit and unknown types are not', () => {
  assert.equal(hasVisitTaskResultModal('gift_delivery'), true);
  assert.equal(hasVisitTaskResultModal('unknown_task'), false);
});
