import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import type { PoolClient } from 'pg';
import { linkBeneficiary } from './beneficiaryLinkService.js';

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
    grants: scope ? [{ permission: options.permission ?? 'service_requests.review', scope }] : [],
  };
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    beneficiary_client_id: null,
    beneficiary_candidate_id: null,
    installed_device_id: null,
    contract_id: null,
    request_type: 'emergency_maintenance',
    status: 'in_review',
    submission_type: 'refer_a_candidate',
    branch_id: 3,
    reviewed_by_user_id: 8,
    reported_device_snapshot: null,
    ...overrides,
  };
}

function fakeDb(options: {
  request?: ReturnType<typeof requestRow>;
  clients?: Record<number, { branch_id: number | null }>;
  candidates?: number[];
  devices?: Record<number, {
    customer_id: number | null;
    contract_id: number | null;
    branch_id: number | null;
    serial_number: string | null;
  }>;
} = {}) {
  const statements: Array<{ text: string; params?: any[] }> = [];
  const row = options.request ?? requestRow();
  const clients = options.clients ?? {};
  const candidates = new Set(options.candidates ?? []);
  const devices = options.devices ?? {};
  const db = {
    async query(text: string, params?: any[]) {
      statements.push({ text, params });
      if (text.includes('FROM service_requests') && text.includes('FOR UPDATE')) {
        return { rows: [row], rowCount: 1 };
      }
      if (text.includes('FROM clients WHERE id')) {
        const client = clients[Number(params?.[0])];
        return { rows: client ? [client] : [], rowCount: client ? 1 : 0 };
      }
      if (text.includes('FROM candidates WHERE id')) {
        const exists = candidates.has(Number(params?.[0]));
        return { rows: exists ? [{ '?column?': 1 }] : [], rowCount: exists ? 1 : 0 };
      }
      if (text.includes('FROM installed_devices')) {
        const device = devices[Number(params?.[0])];
        return { rows: device ? [device] : [], rowCount: device ? 1 : 0 };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;
  return { db, statements };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    serviceRequestId: 101,
    actorUserId: 8,
    actorRole: 'operator' as const,
    isChange: false,
    authContext: context('ASSIGNED'),
    ...overrides,
  };
}

test('device-only linkage preserves the existing beneficiary and adopts the device contract', async () => {
  const { db, statements } = fakeDb({
    request: requestRow({ beneficiary_client_id: 41 }),
    clients: { 41: { branch_id: 3 } },
    devices: {
      77: { customer_id: 41, contract_id: 90, branch_id: 3, serial_number: 'ABC' },
    },
  });

  const result = await linkBeneficiary(input({ installedDeviceId: 77 }), db);

  assert.equal(result.ok, true);
  const update = statements.find(({ text }) => text.includes('UPDATE service_requests'));
  assert.ok(update);
  assert.deepEqual(update.params?.slice(0, 5), [101, 41, null, 77, 90]);
  const audit = statements.find(({ text }) => text.includes('INSERT INTO service_request_audit_log'));
  assert.ok(audit);
  assert.equal(audit.params?.[1], 'linkage_changed');
  assert.match(String(audit.params?.[2]), /"beneficiary_client_id":41/);
  assert.match(String(audit.params?.[2]), /"reason":"installed_device_linked"/);
});

test('normal link cannot overwrite an existing beneficiary and points callers to change-linkage', async () => {
  const { db, statements } = fakeDb({
    request: requestRow({ beneficiary_client_id: 41 }),
  });
  const result = await linkBeneficiary(input({ beneficiaryClientId: 42 }), db);

  assert.deepEqual(result.ok === false ? result.code : null, 'beneficiary_already_linked_use_change');
  assert.equal(statements.some(({ text }) => text.includes('UPDATE service_requests')), false);
  assert.equal(statements.some(({ text }) => text.includes('INSERT INTO service_request_audit_log')), false);
});

test('repeating the same party link is idempotent and does not write another audit event', async () => {
  const { db, statements } = fakeDb({
    request: requestRow({ beneficiary_client_id: 41, installed_device_id: 77 }),
  });
  const result = await linkBeneficiary(input({ beneficiaryClientId: 41 }), db);

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.alreadyLinked, true);
  assert.equal(statements.some(({ text }) => text.includes('UPDATE service_requests')), false);
  assert.equal(statements.some(({ text }) => text.includes('INSERT INTO service_request_audit_log')), false);
});

test('rejects ambiguous and empty payloads before opening a transaction', async () => {
  const { db, statements } = fakeDb();
  const ambiguous = await linkBeneficiary(input({
    beneficiaryClientId: 41,
    beneficiaryCandidateId: 51,
  }), db);
  const empty = await linkBeneficiary(input(), db);

  assert.deepEqual(ambiguous.ok === false ? ambiguous.code : null, 'beneficiary_target_must_be_exclusive');
  assert.deepEqual(empty.ok === false ? empty.code : null, 'beneficiary_or_device_link_required');
  assert.equal(statements.length, 0);
});

test('explicit relink clears an old device and contract owned by the previous beneficiary', async () => {
  const { db, statements } = fakeDb({
    request: requestRow({
      beneficiary_client_id: 41,
      installed_device_id: 77,
      contract_id: 90,
    }),
    clients: { 42: { branch_id: 3 } },
    devices: {
      77: { customer_id: 41, contract_id: 90, branch_id: 3, serial_number: 'ABC' },
    },
  });

  const result = await linkBeneficiary(input({
    beneficiaryClientId: 42,
    isChange: true,
    changeReason: 'تصحيح هوية المستفيد',
  }), db);

  assert.equal(result.ok, true);
  const update = statements.find(({ text }) => text.includes('UPDATE service_requests'));
  assert.ok(update);
  assert.deepEqual(update.params?.slice(0, 5), [101, 42, null, null, null]);
  const audit = statements.find(({ text }) => text.includes('INSERT INTO service_request_audit_log'));
  assert.ok(audit);
  assert.equal(audit.params?.[1], 'linkage_changed');
  assert.match(String(audit.params?.[2]), /"installed_device_id":77/);
  assert.match(String(audit.params?.[2]), /"installed_device_id":null/);
});

test('explicit relink preserves a compatible installed device', async () => {
  const { db, statements } = fakeDb({
    request: requestRow({
      beneficiary_candidate_id: 12,
      installed_device_id: 77,
      contract_id: 90,
    }),
    clients: { 42: { branch_id: 3 } },
    devices: {
      77: { customer_id: 42, contract_id: 90, branch_id: 3, serial_number: 'ABC' },
    },
  });
  const result = await linkBeneficiary(input({ beneficiaryClientId: 42, isChange: true }), db);

  assert.equal(result.ok, true);
  const update = statements.find(({ text }) => text.includes('UPDATE service_requests'));
  assert.ok(update);
  assert.deepEqual(update.params?.slice(0, 5), [101, 42, null, 77, 90]);
});

test('device link rejects a device owned by another client without changing the request', async () => {
  const { db, statements } = fakeDb({
    request: requestRow({ beneficiary_client_id: 41 }),
    clients: { 41: { branch_id: 3 } },
    devices: {
      77: { customer_id: 99, contract_id: 90, branch_id: 3, serial_number: 'ABC' },
    },
  });
  const result = await linkBeneficiary(input({ installedDeviceId: 77 }), db);

  assert.deepEqual(result.ok === false ? result.code : null, 'installed_device_beneficiary_mismatch');
  assert.equal(statements.some(({ text }) => text.includes('UPDATE service_requests')), false);
});

test('enforces missing permission, wrong branch, and unassigned subject before mutation', async () => {
  const actors = [
    context(),
    context('BRANCH', { branches: [9] }),
    context('ASSIGNED', { userId: 99 }),
  ];

  for (const authContext of actors) {
    const { db, statements } = fakeDb();
    const result = await linkBeneficiary(input({ beneficiaryClientId: 41, authContext }), db);
    assert.deepEqual(result.ok === false ? result.code : null, 'forbidden');
    assert.equal(statements.some(({ text }) => text.includes('UPDATE service_requests')), false);
  }
});

test('allows every declared scope and super-admin for an assigned in-review request', async () => {
  const actors = [
    context('GLOBAL'),
    context('BRANCH'),
    context('ASSIGNED'),
    context(undefined, { superAdmin: true }),
  ];

  for (const authContext of actors) {
    const { db, statements } = fakeDb({ clients: { 41: { branch_id: 3 } } });
    const result = await linkBeneficiary(input({ beneficiaryClientId: 41, authContext }), db);
    assert.equal(result.ok, true);
    assert.equal(statements.some(({ text }) => text.includes('UPDATE service_requests')), true);
  }
});
