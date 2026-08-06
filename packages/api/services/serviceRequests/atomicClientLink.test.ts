import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import type { PoolClient } from 'pg';
import { linkNewClientToWaterCheckParty } from './atomicClientLink.js';

const permission = 'water_check.review';

function context(scope?: ScopeType, options: { branches?: number[]; userId?: number; superAdmin?: boolean } = {}): AuthContext {
  return {
    userId: options.userId ?? 8,
    roleId: 2,
    isSuperAdmin: options.superAdmin === true,
    actingBranchId: 3,
    allowedBranchIds: options.branches ?? [3],
    grants: scope ? [{ permission, scope }] : [],
  };
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    request_type: 'water_check',
    status: 'in_review',
    branch_id: 3,
    reviewed_by_user_id: 8,
    escalated_at: null,
    submission_type: 'refer_a_candidate',
    requester_client_id: null,
    referrer_external: null,
    ...overrides,
  };
}

function fakeDb(row = requestRow(), failAt?: 'audit') {
  const statements: Array<{ text: string; params?: any[] }> = [];
  const db = {
    async query(text: string, params?: any[]) {
      statements.push({ text, params });
      if (text.includes('FROM service_requests') && text.includes('FOR UPDATE')) {
        return { rows: [row], rowCount: 1 };
      }
      if (failAt === 'audit' && text.includes('INSERT INTO service_request_audit_log')) {
        throw new Error('audit failed');
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;
  return { db, statements };
}

test('atomically links a newly created beneficiary and audits it', async () => {
  const { db, statements } = fakeDb();
  await linkNewClientToWaterCheckParty({
    db,
    authContext: context('ASSIGNED'),
    serviceRequestId: 102,
    clientId: 43,
    clientBranchId: 3,
    party: 'beneficiary',
  });

  assert.equal(statements.some(({ text }) => text.includes('SET beneficiary_client_id = $2')), true);
  const audit = statements.find(({ text }) => text.includes('INSERT INTO service_request_audit_log'));
  assert.ok(audit);
  assert.match(String(audit.params?.[2]), /"atomic_client_creation":true/);
  const attribution = statements.find(({ text }) => text.includes('INSERT INTO client_referral_attributions'));
  assert.ok(attribution);
  assert.match(attribution.text, /ON CONFLICT DO NOTHING/);
  assert.match(attribution.text, /COALESCE\(b\.referrers, '\[\]'::jsonb\) \|\| jsonb_build_array/);
});

test('denies missing permission, wrong branch, and unassigned reviewer before mutation', async () => {
  const scenarios = [
    { auth: context(), branch: 3, code: 'forbidden' },
    { auth: context('BRANCH', { branches: [9] }), branch: 3, code: 'forbidden' },
    { auth: context('ASSIGNED', { userId: 4 }), branch: 3, code: 'forbidden' },
    { auth: context('GLOBAL'), branch: 9, code: 'service_request_client_branch_mismatch' },
  ];

  for (const scenario of scenarios) {
    const { db, statements } = fakeDb();
    await assert.rejects(
      linkNewClientToWaterCheckParty({
        db,
        authContext: scenario.auth,
        serviceRequestId: 102,
        clientId: 43,
        clientBranchId: scenario.branch,
        party: 'beneficiary',
      }),
      (error: any) => error.code === scenario.code,
    );
    assert.equal(statements.some(({ text }) => text.includes('UPDATE service_requests')), false);
  }
});

test('propagates a linkage failure so the caller can roll back client creation', async () => {
  const { db } = fakeDb(requestRow(), 'audit');
  await assert.rejects(
    linkNewClientToWaterCheckParty({
      db,
      authContext: context('ASSIGNED'),
      serviceRequestId: 102,
      clientId: 43,
      clientBranchId: 3,
      party: 'beneficiary',
    }),
    /audit failed/,
  );
});

test('requester and same-person referrer mirrors stay inside the same transaction', async () => {
  const { db, statements } = fakeDb(requestRow({
    referrer_external: { same_as_requester: true },
  }));
  await linkNewClientToWaterCheckParty({
    db,
    authContext: context('ASSIGNED'),
    serviceRequestId: 102,
    clientId: 50,
    clientBranchId: 3,
    party: 'requester',
  });
  const update = statements.find(({ text }) => text.includes('SET requester_client_id = $2'));
  assert.ok(update);
  assert.match(update.text, /referrer_client_id = CASE/);
  assert.equal(update.params?.[2], true);
});
