import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./clients.ts', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../../web/src/components/ClientModal.tsx', import.meta.url), 'utf8');

// A «شخصي» mediator is the user who brought the client in. Editing any field
// of the client used to replace it with the editor's name (2026-11-02).
test('client update keeps a stored Personal mediator name', () => {
  assert.match(source, /SELECT branch_id, candidate_status, is_active, occupation, referrer_type, referrer_name FROM clients WHERE id = \$1/);
  assert.match(source, /existing\?\.referrer_type === 'Personal'\s*\?\s*\(existing\.referrer_name \?\? ''\)\s*:\s*\(req\.user\?\.name \|\| ''\)/);
  assert.match(source, /enforcePersonalReferrer\(\s*normalizeClientPayload\(req\.body \?\? \{\}\),\s*\{ id: authContext\.userId, name: personalReferrerName \}/);
});

test('client form saves the Personal mediator it shows, not the current user', () => {
  assert.match(modal, /referralType === 'Personal'\s*\?\s*\(referralNameSnapshot\.trim\(\) \|\| currentUserDisplayName\)/);
});
