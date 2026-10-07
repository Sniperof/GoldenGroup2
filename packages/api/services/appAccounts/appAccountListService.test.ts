import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext } from '@golden-crm/shared';
import { buildAppAccountListQuery, listAppAccounts } from './appAccountListService.js';
import pool from '../../db.js';

const actor: AuthContext = {
  userId: 7, roleId: 2, isSuperAdmin: false, allowedBranchIds: [3], actingBranchId: 3,
  grants: [{ permission: 'app_accounts.view', scope: 'GLOBAL' }],
};

test('GLOBAL view queries live accounts across branches without widening any other capability', () => {
  const query = buildAppAccountListQuery(actor, {});
  assert.match(query.text, /a.deleted_at IS NULL/);
  assert.match(query.text, /c.deleted_at IS NULL/);
  assert.match(query.text, /a.status IN \('active', 'suspended'\)/);
  assert.match(query.text, /c.id = a.linked_client_record_id/);
  assert.deepEqual(query.values, [25, 0]);
});

test('explicit super-admin path works without grants or branch assignments', () => {
  assert.doesNotThrow(() => buildAppAccountListQuery({ ...actor, grants: [], isSuperAdmin: true, allowedBranchIds: [] }, {}));
});

test('missing view permission and unrelated client permission are denied', () => {
  for (const grants of [[], [{ permission: 'clients.view_list', scope: 'GLOBAL' as const }]]) {
    assert.throws(() => buildAppAccountListQuery({ ...actor, grants }, {}), { status: 403 });
  }
});

test('unsupported BRANCH and ASSIGNED grants fail closed for wrong branch and unassigned subjects', () => {
  for (const scope of ['BRANCH', 'ASSIGNED'] as const) {
    for (const allowedBranchIds of [[3], []]) {
      assert.throws(() => buildAppAccountListQuery({ ...actor, allowedBranchIds, grants: [{ permission: 'app_accounts.view', scope }] }, {}), { status: 403 });
    }
  }
});

test('search, filters and pagination are bound parameters; ordering is allowlisted', () => {
  const search = "' OR 1=1 --_%";
  const query = buildAppAccountListQuery(actor, { search, status: 'suspended', source: 'admin', limit: '10', offset: '20', sortKey: 'clientName', sortDir: 'asc' });
  assert.deepEqual(query.values, ['suspended', 'admin', "%' OR 1=1 --\\_\\%%", 10, 20]);
  assert.ok(!query.text.includes(search));
  assert.match(query.text, /ORDER BY "clientName" asc, id::bigint DESC/);
});

test('invalid filters, pagination, repeated query values and SQL sort injection are rejected', () => {
  for (const input of [
    { status: 'deleted' }, { source: '__proto__' }, { limit: '101' }, { limit: 0 }, { offset: -1 },
    { offset: '1.5' }, { limit: ['10', '20'] }, { search: ['a', 'b'] }, { search: 'x'.repeat(151) },
    { sortKey: 'createdAt; DROP TABLE app_accounts' }, { sortKey: 'constructor' }, { sortDir: 'DESC NULLS FIRST' },
  ]) assert.throws(() => buildAppAccountListQuery(actor, input), { status: 400 });
});

test('empty pages preserve the filtered total and explicit pagination contract', async (t) => {
  const query = t.mock.method(pool, 'query', async () => ({ rows: [{ items: [], totalCount: 3 }] }));
  assert.deepEqual(await listAppAccounts(actor, { limit: 10, offset: 10 }), { items: [], totalCount: 3, limit: 10, offset: 10 });
  assert.equal(query.mock.callCount(), 1);
});

test('service rejects unauthorized access before touching the database', async (t) => {
  const query = t.mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  await assert.rejects(listAppAccounts({ ...actor, grants: [] }, {}), { status: 403 });
  assert.equal(query.mock.callCount(), 0);
});
