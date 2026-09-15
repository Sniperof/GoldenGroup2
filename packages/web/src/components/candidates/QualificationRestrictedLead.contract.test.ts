import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const modal = readFileSync(new URL('./QualificationModal.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8');

test('the restricted-link action is shown only for same-branch matches and explicit permission', () => {
  assert.match(modal, /canLinkRestrictedLead && autoCheckResult\.reason === 'SAME_BRANCH_RESTRICTED'/);
  assert.doesNotMatch(modal, /reason === 'OTHER_BRANCH_RESTRICTED'[\s\S]{0,200}onRestrictedLeadLink/);
});

test('the browser submits no hidden client id', () => {
  assert.match(api, /linkRestrictedSameBranchLead: \(id: number\)/);
  assert.match(api, /JSON\.stringify\(\{ restrictedSameBranchLead: true \}\)/);
});
