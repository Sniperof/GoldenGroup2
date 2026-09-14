import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, PermissionGrant } from '@golden-crm/shared';
import {
  ContractCustomerLookupError,
  loadContractCustomerContext,
  searchContractCustomers,
} from './contractCustomerLookupService.js';

function auth(grants: PermissionGrant[], overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 7,
    roleId: 2,
    isSuperAdmin: false,
    actingBranchId: 6,
    allowedBranchIds: [6],
    grants,
    ...overrides,
  };
}

const allowed = auth([
  { permission: 'contracts.create', scope: 'BRANCH' },
  { permission: 'clients.view_list', scope: 'BRANCH' },
  { permission: 'clients.view', scope: 'BRANCH' },
]);

function dbWithRows(rows: any[]) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  return {
    calls,
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows };
    },
  };
}

test('short lookup text returns immediately without querying the clients table', async () => {
  const db = dbWithRows([]);
  assert.deepEqual(await searchContractCustomers(db, allowed, 6, 'ا'), { items: [], hasMore: false });
  assert.equal(db.calls.length, 0);
});

test('manual picker uses a bounded lightweight query without count or full client enrichment', async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    id: index + 1,
    name: `زبون ${index + 1}`,
    mobile: '0999000000',
    branchName: 'دمشق',
    legalIdentityComplete: true,
  }));
  const db = dbWithRows(rows);

  const result = await searchContractCustomers(db, allowed, 6, 'زبون', 20);

  assert.equal(result.items.length, 20);
  assert.equal(result.hasMore, true);
  assert.equal(db.calls.length, 1);
  assert.doesNotMatch(db.calls[0].text, /COUNT\s*\(/i);
  assert.doesNotMatch(db.calls[0].text, /LEFT JOIN LATERAL/i);
  assert.match(db.calls[0].text, /LIMIT \$\d+/);
  assert.deepEqual(db.calls[0].params?.at(-1), 21);
});

test('ASSIGNED on either required permission intersects lookup with personal ownership', async () => {
  for (const grants of [
    [
      { permission: 'contracts.create', scope: 'ASSIGNED' as const },
      { permission: 'clients.view_list', scope: 'BRANCH' as const },
    ],
    [
      { permission: 'contracts.create', scope: 'BRANCH' as const },
      { permission: 'clients.view_list', scope: 'ASSIGNED' as const },
    ],
  ]) {
    const db = dbWithRows([]);
    await searchContractCustomers(db, auth(grants), 6, '099');
    assert.match(db.calls[0].text, /FROM client_assignments ca/);
    assert.ok(db.calls[0].params?.includes(7));
  }
});

test('missing client list permission and wrong contract branch fail closed', async () => {
  const noClientView = auth([{ permission: 'contracts.create', scope: 'BRANCH' }]);
  await assert.rejects(
    searchContractCustomers(dbWithRows([]), noClientView, 6, 'زبون'),
    (error: any) => error instanceof ContractCustomerLookupError
      && error.code === 'MISSING_CLIENT_LIST_PERMISSION',
  );

  await assert.rejects(
    searchContractCustomers(dbWithRows([]), allowed, 9, 'زبون'),
    (error: any) => error instanceof ContractCustomerLookupError
      && error.code === 'BRANCH_FORBIDDEN',
  );
});

test('selected customer context is scoped again and normalizes legacy arrays', async () => {
  const db = dbWithRows([{
    id: 91,
    name: 'زبون مختار',
    mobile: null,
    contacts: null,
    referrers: null,
    fatherName: 'أحمد',
    nationalId: '12345678901',
  }]);

  const result = await loadContractCustomerContext(db, allowed, 6, 91);

  assert.equal(result.id, 91);
  assert.deepEqual(result.contacts, []);
  assert.deepEqual(result.referrers, []);
  assert.match(db.calls[0].text, /c\.id = \$\d+/);
  assert.match(db.calls[0].text, /c\.is_candidate = FALSE/);
});

test('an unavailable selected customer is rejected instead of falling back to posted data', async () => {
  await assert.rejects(
    loadContractCustomerContext(dbWithRows([]), allowed, 6, 999),
    (error: any) => error instanceof ContractCustomerLookupError
      && error.status === 403
      && error.code === 'CUSTOMER_OUT_OF_SCOPE',
  );
});

test('legal customer context requires the detailed client-view capability', async () => {
  const listOnly = auth([
    { permission: 'contracts.create', scope: 'BRANCH' },
    { permission: 'clients.view_list', scope: 'BRANCH' },
  ]);

  await assert.rejects(
    loadContractCustomerContext(dbWithRows([]), listOnly, 6, 91),
    (error: any) => error instanceof ContractCustomerLookupError
      && error.code === 'MISSING_PERMISSION',
  );
});
