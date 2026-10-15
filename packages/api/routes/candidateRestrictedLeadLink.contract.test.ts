import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('./candidates.ts', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../policies/candidatePolicy.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../migrations/463_candidate_restricted_same_branch_lead_link.sql', import.meta.url), 'utf8');

test('restricted linking is authorized on the assigned candidate subject', () => {
  assert.match(policy, /candidates\.link_restricted_lead/);
  assert.match(route, /canLinkRestrictedLead\(authContext, candidateSubject\)/);
});

test('restricted matching is exact, same-branch, LEAD-only, and rejects ambiguity', () => {
  assert.match(route, /c\.branch_id = \$2/);
  assert.match(route, /phoneNormalizationSql\('c\.mobile'\)\} = \$1/);
  assert.match(route, /buildClientLifecycleStatusSql\('c'\).* = 'LEAD'/s);
  assert.match(route, /return rows\.length === 1 \? rows\[0\] : null/);
  assert.match(route, /restrictedSameBranchLead && !shouldTransferLeadOwnership/);
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
