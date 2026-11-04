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
  // Manual operations apply at every stage (2026-10-20).
  assert.doesNotMatch(source, /OWNERSHIP_STAGE_LOCKED/);
});

test('bulk ownership rebuilds the table filter result and only adds owners to clients of one branch, at any stage', () => {
  const pagedRoute = source.slice(source.indexOf("router.get('/paged'"), source.indexOf("router.post('/smart-match'"));
  assert.match(pagedRoute, /appendClientListFilterConditions\(req\.query, params, conditions\)/);

  const bulkRoute = source.slice(source.indexOf("router.post('/bulk-ownership'"), source.indexOf("router.get('/:id/network'"));
  assert.match(bulkRoute, /requirePermission\('clients\.assignment\.manage'\)/);
  assert.match(bulkRoute, /BULK_OWNERSHIP_BRANCH_REQUIRED/);
  assert.match(bulkRoute, /appendClientListFilterConditions\(filters, params, conditions\)/);
  assert.match(bulkRoute, /c\.branch_id = \$\$\{params\.length\}/);
  assert.match(bulkRoute, /BULK_OWNERSHIP_STALE/);
  assert.match(bulkRoute, /set_config\('app\.change_context', 'bulk_add', true\)/);
  assert.match(bulkRoute, /INSERT INTO client_assignments[\s\S]*ON CONFLICT \(client_id, hr_user_id\) DO NOTHING/);
  // Every stage (LEAD / FOP / OP) can take owners (2026-10-20).
  assert.doesNotMatch(bulkRoute, /'LEAD'/);
  assert.doesNotMatch(bulkRoute, /DELETE FROM client_assignments/);
  // Ticked rows replace the filters, go through the same scope + branch
  // narrowing, are capped, and must all belong to one branch.
  assert.match(bulkRoute, /c\.id = ANY\(\$\$\{params\.length\}::int\[\]\)/);
  assert.match(bulkRoute, /BULK_OWNERSHIP_INVALID_SELECTION/);
  assert.match(bulkRoute, /BULK_OWNERSHIP_MIXED_BRANCHES/);
});

test('network output removes duplicate rows produced by legacy sheet joins', () => {
  const networkRoute = source.slice(source.indexOf("router.get('/:id/network'"), source.indexOf("router.post('/',"));
  assert.match(networkRoute, /SELECT DISTINCT\s+sheet_id,/);
});

test('personal primary referrer enforcement preserves additional historical referrers', () => {
  assert.match(source, /const additionalReferrers = Array\.isArray\(payload\.referrers\)[\s\S]*payload\.referrers\.slice\(1\)/);
  assert.match(source, /referrers: \[\{[\s\S]*\}, \.\.\.additionalReferrers\]/);
});

test('personal owners stay when a client becomes FOP or OP (2026-10-20)', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const updateRoute = source.slice(source.indexOf("router.put('/:id'"), source.indexOf("router.delete('/:id'"));
  // The edit form's OP/FOP transition no longer clears the owners.
  assert.doesNotMatch(updateRoute, /DELETE FROM client_assignments/);
  // Contract approval promotes the stage without touching the owners.
  assert.doesNotMatch(read('../services/clientLifecycleService.ts'), /client_assignments/);
  // Computed ownership, the «owner = branch» filter and the visit source no
  // longer turn FOP/OP clients into branch-owned ones.
  assert.doesNotMatch(read('../services/customerOwnership.ts'), /IN \('OP', 'FOP'\)/);
  assert.match(source, /conditions\.push\(`NOT \$\{personalOwnerExistsPredicate\('c\.id'\)\}`\)/);
  assert.doesNotMatch(read('./fieldVisits.ts'), /isOpFop/);
  // Only device-demo work is the owner's: the employee-transfer block counts it alone.
  assert.match(read('../services/employeeService.ts'), /ot\.task_type = 'device_demo'[\s\S]{0,200}personalOwnershipPredicate/);
});

test('«زبائني» and supervisor alerts reach owned customers through demo tasks only (2026-10-20)', () => {
  const tasks = readFileSync(new URL('./openTasks.ts', import.meta.url), 'utf8');
  const myCustomers = tasks.slice(tasks.indexOf("router.get('/my-customers'"));
  assert.match(myCustomers, /const ownershipClause = `\(ot\.task_type = 'device_demo' AND \$\{personalOwnershipPredicate\('ot\.client_id', '\$1'\)\}\)`/);
  assert.match(tasks, /AND \(\(ot\.task_type = 'device_demo' AND \$\{personalOwnershipPredicate\('ot\.client_id', '\$3'\)\}\)/);
  // Every personalOwnershipPredicate in task views is paired with the demo filter.
  const uses = tasks.match(/personalOwnershipPredicate\('ot\.client_id'/g) ?? [];
  const demoUses = tasks.match(/ot\.task_type = 'device_demo' AND \$\{personalOwnershipPredicate\('ot\.client_id'/g) ?? [];
  assert.equal(uses.length, demoUses.length);
});
