import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('./candidates.ts', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../policies/candidatePolicy.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../migrations/463_candidate_restricted_same_branch_lead_link.sql', import.meta.url), 'utf8');

test('restricted (blind) linking needs the add-client permission conversion needs, on the name (2026-10-21)', () => {
  const linkRoute = route.slice(route.indexOf("router.post('/:id/link-client'"), route.indexOf("router.put('/:id'"));
  assert.match(linkRoute, /if \(restrictedLink\) \{\s*const restrictedAccess = canCreateClient\(authContext, \{\s*branchId: candidateSubject\.branchId,\s*assignedUserIds: candidateSubject\.assignedUserIds,/);
  // The dedicated permission no longer gates anything.
  assert.doesNotMatch(route, /canLinkRestrictedLead\(/);
  assert.match(policy, /@deprecated 2026-10-21/);
});

test('same-branch restricted matching is exact, any stage, and rejects ambiguity', () => {
  const finder = route.slice(
    route.indexOf('async function findRestrictedSameBranchLead'),
    route.indexOf('async function findRestrictedOtherBranchClient'),
  );
  assert.match(finder, /c\.branch_id = \$2/);
  assert.match(finder, /phoneNormalizationSql\('c\.mobile'\)\} = \$1/);
  assert.doesNotMatch(finder, /= 'LEAD'/);
  assert.match(finder, /return rows\.length === 1 \? rows\[0\] : null/);
  assert.match(route, /if \(restrictedSameBranchLead && !sameBranchLink\)/);
});

test('linking shares ownership for LEAD and FOP clients of the same branch, never OP (2026-10-20)', () => {
  assert.match(
    route,
    /const shouldShareOwnership = \(client\.lifecycleStage === 'LEAD' \|\| client\.lifecycleStage === 'FOP'\) && sameBranchLink/,
  );
  const shareRule = route.slice(route.indexOf('const shouldShareOwnership'), route.indexOf('if (restrictedSameBranchLead && !sameBranchLink)'));
  assert.doesNotMatch(shareRule, /'OP'/);
});

test('linking adds eligible candidate assignees without deleting existing client owners', () => {
  assert.match(route, /resolveTransferableCandidateAssignmentIds/);
  assert.match(route, /ON CONFLICT \(client_id, hr_user_id\) DO NOTHING/);
  assert.doesNotMatch(route, /DELETE FROM client_assignments[\s\S]{0,300}restrictedSameBranchLead/);
});

test('migration grants the narrow permission to customer service supervisors as ASSIGNED', () => {
  assert.match(migration, /candidates\.link_restricted_lead/);
  assert.match(migration, /r\.name = 'customer_service_supervisor'/);
  assert.match(migration, /SELECT r\.id, p\.id, 'ASSIGNED'/);
});

test('cross-branch blind link: one company-wide match in another branch, no ownership, nothing revealed (2026-10-21)', () => {
  const finder = route.slice(
    route.indexOf('async function findRestrictedOtherBranchClient'),
    route.indexOf('async function resolveTransferableCandidateAssignmentIds'),
  );
  // Matched on phone across the whole company (no branch filter), exactly one, not in the name's branch.
  assert.doesNotMatch(finder, /c\.branch_id = \$2/);
  assert.match(finder, /if \(rows\.length !== 1\) return null;/);
  assert.match(finder, /Number\(match\.branchId\) !== Number\(candidate\.branchId\)/);
  const linkRoute = route.slice(route.indexOf("router.post('/:id/link-client'"), route.indexOf("router.put('/:id'"));
  // Only edit access to the name: no client edit check on either restricted path.
  assert.match(linkRoute, /if \(!restrictedLink && !editClientAccess\.allowed\)/);
  assert.match(linkRoute, /restricted_other_branch_match_unavailable/);
  assert.match(linkRoute, /restricted_other_branch_match_changed/);
  // Ownership follows sameBranchLink, which a cross-branch match never satisfies.
  assert.match(linkRoute, /const shouldShareOwnership = \(client\.lifecycleStage === 'LEAD' \|\| client\.lifecycleStage === 'FOP'\) && sameBranchLink/);
  // Both restricted links hide the client in the response.
  assert.match(linkRoute, /clientId: restrictedLink \? null : clientId/);
  assert.match(linkRoute, /lifecycleStage: restrictedLink \? null : client\.lifecycleStage/);
});
