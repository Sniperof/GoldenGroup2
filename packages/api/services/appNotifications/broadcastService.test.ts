import assert from 'node:assert/strict';
import test from 'node:test';
import { previewAudience } from './broadcastService.js';
import type { Queryable } from './notificationService.js';

/** Captures the SQL + params the audience builder produced. */
function spyDb() {
  const seen: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    async query(sql: string, params?: unknown[]) {
      seen.push({ sql, params: params ?? [] });
      return { rows: [{ accounts: 5, clients: 4, reachable: 3 }], rowCount: 1 };
    },
  };
  return { db, seen };
}

test('an unfiltered audience still excludes suspended, deleted and orphaned rows', async () => {
  const { db, seen } = spyDb();
  const out = await previewAudience({}, db);
  assert.deepEqual(out, { accounts: 5, clients: 4, reachableByPush: 3 });
  const { sql, params } = seen[0];
  assert.match(sql, /a\.status = 'active'/);
  assert.match(sql, /a\.deleted_at IS NULL/);
  assert.match(sql, /c\.deleted_at IS NULL/);
  assert.deepEqual(params, []);
});

test('the branch ceiling is applied even when the operator picked no branch', async () => {
  const { db, seen } = spyDb();
  await previewAudience({ allowedBranchIds: [3, 7] }, db);
  assert.match(seen[0].sql, /c\.branch_id = ANY\(\$1::int\[\]\)/);
  assert.deepEqual(seen[0].params, [[3, 7]]);
});

test('a chosen branch narrows on top of the ceiling, never instead of it', async () => {
  const { db, seen } = spyDb();
  await previewAudience({ branchId: 3, allowedBranchIds: [3, 7] }, db);
  const { sql, params } = seen[0];
  assert.match(sql, /c\.branch_id = \$1/, 'the chosen branch');
  assert.match(sql, /c\.branch_id = ANY\(\$2::int\[\]\)/, 'and the ceiling');
  assert.deepEqual(params, [3, [3, 7]]);
});

test('the geo cascade matches any level of the subtree, like the clients filter', async () => {
  const { db, seen } = spyDb();
  await previewAudience({ geoIds: ['10', '11', '12'] }, db);
  const { sql, params } = seen[0];
  assert.match(sql, /c\.governorate::text = ANY\(\$1::text\[\]\)/);
  assert.match(sql, /c\.district::text = ANY\(\$1::text\[\]\)/);
  assert.match(sql, /c\.neighborhood::text = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(params, [['10', '11', '12']]);
});

test('non-numeric geo ids are dropped rather than passed to SQL', async () => {
  const { db, seen } = spyDb();
  await previewAudience({ geoIds: ['10', 'x; DROP TABLE clients', ''] }, db);
  assert.deepEqual(seen[0].params, [['10']]);
});

test('an empty geo list adds no predicate at all', async () => {
  const { db, seen } = spyDb();
  await previewAudience({ geoIds: [] }, db);
  assert.doesNotMatch(seen[0].sql, /governorate/);
  assert.deepEqual(seen[0].params, []);
});

test('a single-customer send is expressed as a client predicate', async () => {
  const { db, seen } = spyDb();
  await previewAudience({ clientId: 8 }, db);
  assert.match(seen[0].sql, /c\.id = \$1/);
  assert.deepEqual(seen[0].params, [8]);
});

test('reachable-by-push is counted separately from inbox recipients', async () => {
  const { db, seen } = spyDb();
  const out = await previewAudience({}, db);
  assert.match(seen[0].sql, /FILTER \(WHERE r\.app_account_id IS NOT NULL\)/);
  assert.equal(out.accounts, 5);
  assert.equal(out.reachableByPush, 3, 'two recipients will only see it in-app');
});
