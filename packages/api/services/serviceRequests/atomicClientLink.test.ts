import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import type { PoolClient } from 'pg';
import { linkNewClientToServiceRequestParty } from './atomicClientLink.js';

function context(
  scope?: ScopeType,
  options: { branches?: number[]; userId?: number; superAdmin?: boolean; permission?: string } = {},
): AuthContext {
  return {
    userId: options.userId ?? 8,
    roleId: 2,
    isSuperAdmin: options.superAdmin === true,
    actingBranchId: 3,
    allowedBranchIds: options.branches ?? [3],
    grants: scope ? [{ permission: options.permission ?? 'water_check.review', scope }] : [],
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
    beneficiary_client_id: null,
    referrer_client_id: null,
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
  await linkNewClientToServiceRequestParty({
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
      linkNewClientToServiceRequestParty({
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
    linkNewClientToServiceRequestParty({
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

test('rejects atomic creation when the requested party was linked by a concurrent operation', async () => {
  const scenarios = [
    { party: 'beneficiary' as const, row: { beneficiary_client_id: 91 } },
    { party: 'requester' as const, row: { requester_client_id: 92 } },
    {
      party: 'referrer' as const,
      row: { referrer_client_id: 93, referrer_external: { name: 'وسيط' } },
    },
  ];

  for (const scenario of scenarios) {
    const { db, statements } = fakeDb(requestRow(scenario.row));
    await assert.rejects(
      linkNewClientToServiceRequestParty({
        db,
        authContext: context('ASSIGNED'),
        serviceRequestId: 102,
        clientId: 60,
        clientBranchId: 3,
        party: scenario.party,
      }),
      (error: any) => error.status === 409 && error.code === 'service_request_party_already_linked',
    );
    assert.equal(statements.some(({ text }) => text.includes('UPDATE service_requests')), false);
    assert.equal(statements.some(({ text }) => text.includes('INSERT INTO service_request_audit_log')), false);
  }
});

test('requester and same-person referrer mirrors stay inside the same transaction', async () => {
  const { db, statements } = fakeDb(requestRow({
    referrer_external: { same_as_requester: true },
  }));
  await linkNewClientToServiceRequestParty({
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

test('device-request beneficiary creation adopts the newly created client branch', async () => {
  const { db, statements } = fakeDb(requestRow({ request_type: 'device_request', branch_id: null }));
  const auth: AuthContext = {
    ...context(undefined, { superAdmin: true }),
    grants: [],
  };
  await linkNewClientToServiceRequestParty({
    db,
    authContext: auth,
    serviceRequestId: 103,
    clientId: 51,
    clientBranchId: 7,
    party: 'beneficiary',
  });
  const update = statements.find(({ text }) => text.includes('SET beneficiary_client_id = $2'));
  assert.ok(update);
  assert.match(update.text, /branch_id = CASE WHEN request_type = 'device_request' THEN \$3/);
  assert.equal(update.params?.[2], 7);
  assert.equal(statements.some(({ text }) => text.includes('client_referral_attributions')), false);
});

test('supports typed client linkage for every request type with shared client-party creation', async () => {
  const cases = [
    { requestType: 'emergency_maintenance', permission: 'service_requests.review' },
    { requestType: 'water_check', permission: 'water_check.review' },
    { requestType: 'device_request', permission: 'service_requests.review' },
    { requestType: 'periodic_maintenance', permission: 'periodic_maintenance.review' },
    { requestType: 'golden_warranty', permission: 'golden_warranty.review' },
    { requestType: 'agent_license', permission: 'agent_license.review' },
  ];

  for (const entry of cases) {
    const { db, statements } = fakeDb(requestRow({ request_type: entry.requestType }));
    await linkNewClientToServiceRequestParty({
      db,
      authContext: context('ASSIGNED', { permission: entry.permission }),
      serviceRequestId: 104,
      clientId: 52,
      clientBranchId: 3,
      party: 'requester',
    });
    assert.equal(
      statements.some(({ text }) => text.includes('SET requester_client_id = $2')),
      true,
      entry.requestType,
    );
  }
});

test('uses the request-type permission family when linking a newly created client', async () => {
  const { db, statements } = fakeDb(requestRow({ request_type: 'periodic_maintenance' }));
  await assert.rejects(
    linkNewClientToServiceRequestParty({
      db,
      authContext: context('ASSIGNED', { permission: 'service_requests.review' }),
      serviceRequestId: 105,
      clientId: 53,
      clientBranchId: 3,
      party: 'requester',
    }),
    (error: any) => error.code === 'forbidden',
  );
  assert.equal(statements.some(({ text }) => text.includes('UPDATE service_requests')), false);
});

test('periodic requester linkage accepts every declared review scope and super-admin', async () => {
  const actors = [
    context('GLOBAL', { permission: 'periodic_maintenance.review' }),
    context('BRANCH', { permission: 'periodic_maintenance.review' }),
    context('ASSIGNED', { permission: 'periodic_maintenance.review' }),
    context(undefined, { superAdmin: true }),
  ];

  for (const authContext of actors) {
    const { db, statements } = fakeDb(requestRow({ request_type: 'periodic_maintenance' }));
    await linkNewClientToServiceRequestParty({
      db,
      authContext,
      serviceRequestId: 106,
      clientId: 54,
      clientBranchId: 3,
      party: 'requester',
    });
    assert.equal(statements.some(({ text }) => text.includes('SET requester_client_id = $2')), true);
  }
});

test('periodic requester linkage denies a wrong branch and an unassigned reviewer', async () => {
  const actors = [
    context('BRANCH', { branches: [9], permission: 'periodic_maintenance.review' }),
    context('ASSIGNED', { userId: 99, permission: 'periodic_maintenance.review' }),
  ];

  for (const authContext of actors) {
    const { db, statements } = fakeDb(requestRow({ request_type: 'periodic_maintenance' }));
    await assert.rejects(
      linkNewClientToServiceRequestParty({
        db,
        authContext,
        serviceRequestId: 107,
        clientId: 55,
        clientBranchId: 3,
        party: 'requester',
      }),
      (error: any) => error.code === 'forbidden',
    );
    assert.equal(statements.some(({ text }) => text.includes('UPDATE service_requests')), false);
  }
});

test('golden-warranty mediator linkage stays fail-closed pending its contract decision', async () => {
  const { db, statements } = fakeDb(requestRow({
    request_type: 'golden_warranty',
    referrer_external: { name: 'وسيط مؤجل' },
  }));
  await assert.rejects(
    linkNewClientToServiceRequestParty({
      db,
      authContext: context('ASSIGNED', { permission: 'golden_warranty.review' }),
      serviceRequestId: 108,
      clientId: 56,
      clientBranchId: 3,
      party: 'referrer',
    }),
    (error: any) => error.code === 'golden_warranty_referrer_not_supported',
  );
  assert.equal(statements.some(({ text }) => text.includes('UPDATE service_requests')), false);
});
