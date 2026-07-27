import assert from 'node:assert/strict';
import test from 'node:test';
import { OPEN_TASK_CLIENT_DEVICE_LIFECYCLE_SELECT } from './openTaskClientProjection.js';

test('client task projection exposes device lifecycle metadata required by eligibility checks', () => {
  assert.match(
    OPEN_TASK_CLIENT_DEVICE_LIFECYCLE_SELECT,
    /ot\.service_branch_id AS "serviceBranchId"/,
  );
  assert.match(
    OPEN_TASK_CLIENT_DEVICE_LIFECYCLE_SELECT,
    /ot\.retrieval_purpose AS "retrievalPurpose"/,
  );
  assert.match(
    OPEN_TASK_CLIENT_DEVICE_LIFECYCLE_SELECT,
    /ot\.transfer_kind AS "transferKind"/,
  );
});
