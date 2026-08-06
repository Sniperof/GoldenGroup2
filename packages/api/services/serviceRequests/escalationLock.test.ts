import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { claimOrTakeOver } from './claimService.js';
import { transitionStatus } from './stateMachine.js';

function fakeDb(row: Record<string, unknown>): PoolClient {
  return {
    query: async () => ({ rows: [row], rowCount: 1 }),
  } as unknown as PoolClient;
}

test('an escalated request cannot be claimed through a service wrapper', async () => {
  const result = await claimOrTakeOver({
    serviceRequestId: 10,
    operatorUserId: 5,
    actorRole: 'operator',
  }, fakeDb({
    id: 10,
    status: 'received',
    reviewed_by_user_id: null,
    escalated_at: new Date().toISOString(),
  }));
  assert.deepEqual(result, { ok: false, code: 'request_is_escalated_actions_blocked' });
});

test('an escalated request cannot transition except through the reject exit', async () => {
  const result = await transitionStatus({
    serviceRequestId: 10,
    toStatus: 'cancelled',
    actorUserId: 5,
    actorRole: 'operator',
  }, fakeDb({
    id: 10,
    status: 'in_review',
    channel: 'mobile_app',
    request_type: 'account_creation',
    reviewed_by_user_id: 5,
    reopen_count: 0,
    review_required_flag: true,
    escalated_at: new Date().toISOString(),
    duplicate_flag: false,
    archived_at: null,
  }));
  assert.deepEqual(result, { ok: false, code: 'request_is_escalated_actions_blocked' });
});

test('an escalated request cannot be rejected before it has been claimed', async () => {
  const result = await transitionStatus({
    serviceRequestId: 10,
    toStatus: 'rejected',
    actorUserId: 9,
    actorRole: 'audit_admin',
    triageOutcome: 'invalid_request',
  }, fakeDb({
    id: 10,
    status: 'in_review',
    channel: 'mobile_app',
    request_type: 'water_check',
    reviewed_by_user_id: null,
    reopen_count: 0,
    review_required_flag: false,
    escalated_at: new Date().toISOString(),
    duplicate_flag: false,
    archived_at: null,
  }));
  assert.deepEqual(result, {
    ok: false,
    code: 'rejected_requires_claim',
    message: 'SR-R007: claim the request (assign a reviewer) before this decision',
  });
});
