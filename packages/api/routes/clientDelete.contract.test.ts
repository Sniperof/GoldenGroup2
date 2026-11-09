import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./clients.ts', import.meta.url), 'utf8');
const start = source.indexOf("router.delete('/:id', requirePermission('clients.delete')");
const route = source.slice(start, source.indexOf('router.post(\'/bulk-delete\'', start));
const blockers = source.slice(source.indexOf('const CLIENT_DELETE_BLOCKERS'), start);

test('client delete runs its guards, cascade and soft delete in one locked transaction', () => {
  assert.ok(start > 0);
  assert.match(route, /runWithChangeContext\(\{ changeContext: 'client_deleted' \}/);
  assert.match(route, /await db\.query\('BEGIN'\)/);
  assert.match(route, /loadClientSubject\(clientId!, db, true\)/);
  assert.match(route, /await db\.query\('COMMIT'\)/);
  // Every write goes through the transaction's connection.
  assert.doesNotMatch(route, /pool\.query\(/);
  assert.match(route, /alreadyDeleted/);
});

test('client delete is blocked by every kind of data that makes a client real', () => {
  for (const key of [
    'contracts', 'visits', 'completed_tasks', 'devices', 'service_agreements', 'money',
    'gifts', 'service_requests', 'complaints', 'app_account', 'mediator', 'transfer_target',
  ]) {
    assert.match(blockers, new RegExp(`key: '${key}'`), key);
  }
  assert.match(route, /code: 'CLIENT_DELETE_BLOCKED'/);
});

test('client delete does not return raw database errors', () => {
  assert.doesNotMatch(route, /err\.message/);
});

// The soft delete only sets deleted_at: every list, count and picker must
// leave the client out, or it stays on screen after a successful delete.
test('a deleted client leaves the lists, the duplicate checks and the contract picker', () => {
  const scope = source.slice(source.indexOf('function appendClientScopeConditions'), source.indexOf('const CLIENT_SORT_COLUMNS'));
  assert.match(scope, /const conditions: string\[\] = \['c\.deleted_at IS NULL'\]/);
  const duplicate = source.slice(source.indexOf('async function findDuplicateClientByPhone'), source.indexOf('function buildSmartMatchResponse'));
  assert.match(duplicate, /c\.deleted_at IS NULL/);
  const lookup = readFileSync(new URL('../services/contractCustomerLookupService.ts', import.meta.url), 'utf8');
  assert.equal(lookup.match(/'c\.is_candidate = FALSE', 'c\.deleted_at IS NULL'/g)?.length, 2);
  const candidateDuplicate = readFileSync(new URL('../services/candidateDuplicateDetection.ts', import.meta.url), 'utf8');
  assert.match(candidateDuplicate, /c\.is_candidate = FALSE\s+AND c\.deleted_at IS NULL/);
});
