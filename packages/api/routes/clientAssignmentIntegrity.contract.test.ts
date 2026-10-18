import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./clients.ts', import.meta.url), 'utf8');

test('client data and audit commit atomically, and the edit form cannot change ownership', () => {
  const updateRoute = source.slice(source.indexOf("router.put('/:id'"), source.indexOf("router.delete('/:id'"));
  assert.match(updateRoute, /await db\.query\('BEGIN'\)/);
  assert.match(updateRoute, /loadClientSubject\(clientId!, db, true\)/);
  assert.match(updateRoute, /await db\.query\(\s*`UPDATE clients SET/);
  assert.match(updateRoute, /INSERT INTO client_audit_log/);
  assert.match(updateRoute, /await db\.query\('COMMIT'\)/);
  assert.match(updateRoute, /await db\.query\('ROLLBACK'\)/);
  // Ownership moved to its own operation (migration 481).
  assert.match(updateRoute, /req\.body\?\.assignmentUserIds !== undefined[\s\S]*OWNERSHIP_OPERATION_REQUIRED/);
  assert.doesNotMatch(updateRoute, /insertClientAssignments\(/);
});

test('assignment resolution denies users without an active assignment to the client branch', () => {
  assert.match(source, /FROM user_branch_assignments uba[\s\S]*uba\.branch_id = \$2[\s\S]*uba\.status = 'active'/);
  assert.match(source, /USER_OUTSIDE_CLIENT_BRANCH/);
});

test('ownership operations lock the client, require a reason and label the log', () => {
  const operationsRoute = source.slice(
    source.indexOf("router.post('/:id/ownership/operations'"),
    source.indexOf("router.get('/:id/network'"),
  );
  assert.match(operationsRoute, /requirePermission\('clients\.assignment\.manage'\)/);
  assert.match(operationsRoute, /OWNERSHIP_REASON_REQUIRED/);
  assert.match(operationsRoute, /await db\.query\('BEGIN'\)[\s\S]*FOR UPDATE OF c/);
  assert.match(operationsRoute, /canManageClientAssignments\(authContext, branchId\)/);
  assert.match(operationsRoute, /set_config\('app\.change_context', \$1, true\)[\s\S]*`manual_\$\{action\}`, reason/);
  assert.match(operationsRoute, /resolveAssignmentUserIds\(rawIds, branchId, db\)/);
  assert.match(operationsRoute, /await db\.query\('COMMIT'\)/);
});

test('network output removes duplicate rows produced by legacy sheet joins', () => {
  const networkRoute = source.slice(source.indexOf("router.get('/:id/network'"), source.indexOf("router.post('/',"));
  assert.match(networkRoute, /SELECT DISTINCT\s+sheet_id,/);
});

test('personal primary referrer enforcement preserves additional historical referrers', () => {
  assert.match(source, /const additionalReferrers = Array\.isArray\(payload\.referrers\)[\s\S]*payload\.referrers\.slice\(1\)/);
  assert.match(source, /referrers: \[\{[\s\S]*\}, \.\.\.additionalReferrers\]/);
});
