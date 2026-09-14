import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const candidatesRoute = readFileSync(new URL('../routes/candidates.ts', import.meta.url), 'utf8');
const clientsRoute = readFileSync(new URL('../routes/clients.ts', import.meta.url), 'utf8');
const candidateStore = readFileSync(
  new URL('../../web/src/hooks/useCandidateStore.ts', import.meta.url),
  'utf8',
);

test('duplicate detection is server-side and ignores client-supplied flags (BR-2)', () => {
  assert.match(candidatesRoute, /detectCandidateDuplicate\(db, collectCandidatePhones\(c\)\)/);
  assert.match(
    candidatesRoute,
    /detectCandidateDuplicate\(\s*db,\s*collectCandidatePhones\(c\),\s*Number\(candidateId\),\s*\)/,
  );

  // The insert/update parameter lists must bind the server verdict, never the
  // duplicate fields that arrived in the request body.
  assert.ok(candidatesRoute.includes('duplicate.duplicateFlag, duplicate.duplicateType'));
  assert.ok(!candidatesRoute.includes('c.duplicateFlag'));
  assert.ok(!candidatesRoute.includes('c.duplicateType'));
  assert.ok(!candidatesRoute.includes('c.duplicateReferenceId'));
});

test('the candidate list query carries no dead referral_sheets join', () => {
  const listStart = candidatesRoute.indexOf("router.get('/', requirePermission('candidates.view_list')");
  const listEnd = candidatesRoute.indexOf("router.get('/:id'", listStart);
  assert.ok(listStart > 0 && listEnd > listStart);
  const listRoute = candidatesRoute.slice(listStart, listEnd);
  assert.ok(listRoute.includes('FROM candidates c'));
  assert.ok(!listRoute.includes('referral_sheets'));
});

test('sheet statistics are recomputed by the server on every candidate mutation', () => {
  // create, edit (both the sheet left and the sheet joined), link, delete
  assert.ok(candidatesRoute.includes('recomputeReferralSheetStats(db, requestedSheetId)'));
  assert.ok(candidatesRoute.includes('recomputeReferralSheetStats(db, previousSheetId)'));
  assert.ok(candidatesRoute.includes('recomputeReferralSheetStats(db, nextSheetId)'));
  assert.ok(candidatesRoute.includes('recomputeReferralSheetStats(db, candidate.referralSheetId)'));
  assert.ok(candidatesRoute.includes("recomputeReferralSheetStats(pool, deleted[0]?.referralSheetId)"));
  // and qualification, which happens inside the client-creation transaction
  assert.ok(clientsRoute.includes("recomputeReferralSheetStats(db, convertedCandidate[0]?.referralSheetId)"));
});

test('the candidates page never pulls the whole clients table to check a phone', () => {
  assert.ok(
    !candidateStore.includes('api.clients.list()'),
    'useCandidateStore must not fetch the full clients list — duplicate detection is server-side',
  );
  assert.ok(!candidateStore.includes('updateSheetStats'));
});

test('qualification records HOW it happened and stops asserting duplicate_flag', () => {
  // Both paths used to write `duplicate_flag = TRUE` and nothing else to tell
  // them apart, so «تم التحويل» was unreachable and a fully-converted sheet
  // scored 0% quality (migration 440).
  assert.ok(!clientsRoute.includes("converted_to_lead_id = $2,\n                duplicate_flag = TRUE"));
  assert.match(clientsRoute, /qualification_kind = 'converted'/);
  assert.match(candidatesRoute, /qualification_kind = 'linked'/);

  // Conversion re-derives the verdict while EXCLUDING the client it just became,
  // otherwise the name is a duplicate of itself.
  assert.match(
    clientsRoute,
    /detectCandidateDuplicate\(\s*db,\s*collectCandidatePhones\([^)]*\),\s*Number\(sourceCandidateId\),\s*Number\(inserted\.id\),\s*\)/,
  );

  // Linking passes no client exclusion: the client it matched pre-existed, so
  // the name really is a duplicate and must stay flagged.
  assert.match(
    candidatesRoute,
    /const linkDuplicate = await detectCandidateDuplicate\(\s*db,\s*collectCandidatePhones\(candidate\),\s*candidateId,\s*\)/,
  );
});

test('sheet quality excludes linked names explicitly, not via duplicate_flag', () => {
  const stats = readFileSync(new URL('./referralSheetStats.ts', import.meta.url), 'utf8');
  assert.match(stats, /qualification_kind IS DISTINCT FROM 'linked'/);
});
