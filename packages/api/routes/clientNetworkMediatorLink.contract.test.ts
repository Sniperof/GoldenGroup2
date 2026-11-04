import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./clients.ts', import.meta.url), 'utf8');
const networkRoute = source.slice(
  source.indexOf("router.get('/:id/network'"),
  source.indexOf("router.post('/',"),
);
const networkTab = readFileSync(
  new URL('../../web/src/pages/clientProfile/NetworkTab.tsx', import.meta.url),
  'utf8',
);
const mediatorTable = networkTab.slice(
  networkTab.indexOf('const mediatorColumns'),
  networkTab.indexOf('const referralColumns'),
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
  assert.match(networkTab, /function mediatorLink\(ref: NetworkMediator\)/);
  assert.match(networkTab, /ref\.entityKind === 'client' && ref\.entityId\) return `\/clients\/\$\{ref\.entityId\}`/);
  assert.match(networkTab, /ref\.entityKind === 'employee' && ref\.entityId\) return `\/employees\/\$\{ref\.entityId\}`/);
  // An employee mediator must never be rendered as a client link again.
  assert.doesNotMatch(mediatorTable, /\/clients\/\$\{ref\.id\}/);
  assert.match(mediatorTable, /mediatorLink\(ref\)/);
});

test('a mediator with no record of its own still opens the suggested name', () => {
  // A free-text snapshot is never matched against the directory by name — the
  // same snapshot regularly matches several different people. The suggested
  // name the client was qualified from has its own column and link.
  assert.match(mediatorTable, /to=\{`\/candidates\/\$\{ref\.sourceCandidateId\}`\}/);
  // Which means the server must keep returning the stamp the link needs.
  assert.match(networkRoute, /sourceCandidateId: Number\.isInteger\(resolvedSourceCandidateId\)/);
});

test('a linked duplicate earns no acquisition credit and purchase credit only after the link (2026-10-20)', () => {
  // Server: "via link" follows how the name was qualified, never the client's primary referrer.
  assert.match(networkRoute, /const viaLinkSql = `\(n\.is_client AND n\.link_kind = 'linked'\)`/);
  assert.match(networkRoute, /COALESCE\(buy\.closing_date, buy\.created_at\)::date >= lk\.linked_on/);
  assert.match(networkRoute, /viaDuplicateLink: linkedCandidate\?\.qualificationKind === 'linked'/);
  // Sheet names follow their own conversion link, not a sheet-wide client join.
  assert.match(networkRoute, /LEFT JOIN clients cli ON cli\.id = can\.converted_to_lead_id AND cli\.deleted_at IS NULL/);
  assert.doesNotMatch(networkRoute, /LEFT JOIN clients cli ON cli\.referral_sheet_id = rs\.id/);
  // UI: the summary counts credit, not raw client rows.
  assert.match(networkTab, /return ref\.isClient && !ref\.viaDuplicateLink;/);
  assert.match(networkTab, /return !ref\.viaDuplicateLink \|\| ref\.boughtAfterLink;/);
  assert.match(networkTab, /outgoing\.filter\(earnsAcquisition\)/);
  assert.match(networkTab, /outgoing\.filter\(earnsPurchase\)/);
});

test('each mediator shows who made them a mediator of the client (migration 486, 2026-10-21)', () => {
  const candidatesRoute = readFileSync(new URL('./candidates.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../../../migrations/486_candidate_qualified_by.sql', import.meta.url), 'utf8');
  // Linking and converting both stamp the actor and the time on the name.
  assert.match(candidatesRoute, /qualification_kind = 'linked',[\s\S]{0,200}qualified_by = \$6,\s*qualified_at = NOW\(\)/);
  assert.match(source, /qualification_kind = 'converted',[\s\S]{0,200}qualified_by = \$6,\s*qualified_at = NOW\(\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS qualified_by INTEGER REFERENCES public\.hr_users\(id\) ON DELETE SET NULL/);
  // Network: the qualifier of the name behind the entry, else the client's creator.
  assert.match(networkRoute, /recordedByName: linkedCandidate \? \(linkedCandidate\.qualifiedByName \?\? null\) : \(incomingRow\.creator_name \?\? null\)/);
  // An unstamped entry never claims a name another entry is stamped with.
  assert.match(networkRoute, /if \(sourceCandidateIds\.includes\(Number\(row\.id\)\)\) return false;/);
  assert.match(networkTab, /label: 'سجّله'/);
});
