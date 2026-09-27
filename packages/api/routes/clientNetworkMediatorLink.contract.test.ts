import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./clients.ts', import.meta.url), 'utf8');
const networkRoute = source.slice(
  source.indexOf("router.get('/:id/network'"),
  source.indexOf("router.post('/',"),
);
const clientProfile = readFileSync(
  new URL('../../web/src/pages/ClientProfile.tsx', import.meta.url),
  'utf8',
);

test('a mediator entity id is resolved together with its type, not as a bare client id', () => {
  assert.match(networkRoute, /referrerEntityKinds: Record<string, 'client' \| 'employee'>/);
  assert.match(networkRoute, /const entityKind = referrerEntityKinds\[normalizeMatchText\(referrerType\)\] \?\? null/);
  // The id is only carried when the type says which table it addresses.
  assert.match(networkRoute, /entityKind !== null\s*&& Number\.isInteger\(rawReferrerEntityId\)/);
  assert.match(networkRoute, /const linkedClientId = entityKind === 'client' \? linkedEntityId : null/);
  assert.match(networkRoute, /entityId: linkedEntityId,\s*entityKind,/);
});

test('the mediator phone lookup stays restricted to client mediators', () => {
  const lookup = networkRoute.slice(
    networkRoute.indexOf('let mobile = null;'),
    networkRoute.indexOf('incoming.push({'),
  );
  assert.match(lookup, /if \(linkedClientId != null\)/);
  assert.match(lookup, /SELECT mobile FROM clients WHERE id = \$1/);
  assert.doesNotMatch(lookup, /FROM employees/);
});

test('the network tab routes the mediator link by entity kind', () => {
  assert.match(clientProfile, /function referrerLink\(ref: any\)/);
  assert.match(clientProfile, /ref\.entityKind === 'client' && ref\.entityId\) return \{ path: `\/clients\/\$\{ref\.entityId\}`/);
  assert.match(clientProfile, /ref\.entityKind === 'employee' && ref\.entityId\) return \{ path: `\/employees\/\$\{ref\.entityId\}`/);
  // An employee mediator must never be rendered as a client link again.
  const incomingRow = clientProfile.slice(
    clientProfile.indexOf('{incoming.map('),
    clientProfile.indexOf('القسم 2: الأسماء المقترحة'),
  );
  assert.doesNotMatch(incomingRow, /to=\{`\/clients\/\$\{ref\.id\}`\}/);
  assert.match(incomingRow, /referrerLink\(ref\)/);
});

test('a mediator with no record of its own falls back to the suggested name', () => {
  // A free-text snapshot is never matched against the directory by name — the
  // same snapshot regularly matches several different people.
  assert.match(
    clientProfile,
    /ref\.sourceCandidateId\) return \{ path: `\/candidates\/\$\{ref\.sourceCandidateId\}`, label: 'الاسم المقترح' \}/,
  );
  // Which means the server must keep returning the stamp the fallback needs.
  assert.match(networkRoute, /sourceCandidateId: Number\.isInteger\(resolvedSourceCandidateId\)/);
});
