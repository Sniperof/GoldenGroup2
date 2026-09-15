import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./clients.ts', import.meta.url), 'utf8');

test('client data, assignment replacement, and audit commit atomically', () => {
  const updateRoute = source.slice(source.indexOf("router.put('/:id'"), source.indexOf("router.delete('/:id'"));
  assert.match(updateRoute, /await db\.query\('BEGIN'\)/);
  assert.match(updateRoute, /loadClientSubject\(clientId!, db, true\)/);
  assert.match(updateRoute, /await db\.query\(\s*`UPDATE clients SET/);
  assert.match(updateRoute, /await db\.query\('DELETE FROM client_assignments/);
  assert.match(updateRoute, /insertClientAssignments\([^;]+, db\)/);
  assert.match(updateRoute, /INSERT INTO client_audit_log/);
  assert.match(updateRoute, /await db\.query\('COMMIT'\)/);
  assert.match(updateRoute, /await db\.query\('ROLLBACK'\)/);
});

test('assignment resolution denies users without an active assignment to the client branch', () => {
  assert.match(source, /FROM user_branch_assignments uba[\s\S]*uba\.branch_id = \$2[\s\S]*uba\.status = 'active'/);
  assert.match(source, /USER_OUTSIDE_CLIENT_BRANCH/);
  assert.match(source, /resolveAssignmentUserIds\(\s*newAssigneeIds,[\s\S]*Number\(lockedSubject\.branchId\),[\s\S]*db/);
});

test('network output removes duplicate rows produced by legacy sheet joins', () => {
  const networkRoute = source.slice(source.indexOf("router.get('/:id/network'"), source.indexOf("router.post('/',"));
  assert.match(networkRoute, /SELECT DISTINCT\s+sheet_id,/);
});

test('personal primary referrer enforcement preserves additional historical referrers', () => {
  assert.match(source, /const additionalReferrers = Array\.isArray\(payload\.referrers\)[\s\S]*payload\.referrers\.slice\(1\)/);
  assert.match(source, /referrers: \[\{[\s\S]*\}, \.\.\.additionalReferrers\]/);
});
