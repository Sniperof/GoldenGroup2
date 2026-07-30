import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const employeeService = readFileSync(new URL('./employeeService.ts', import.meta.url), 'utf8');
const branchAssignmentService = readFileSync(new URL('./userBranchAssignmentService.ts', import.meta.url), 'utf8');
const employeesRoute = readFileSync(new URL('../routes/employees.ts', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../../migrations/386_employee_branch_source_of_truth.sql', import.meta.url),
  'utf8',
);

// ── Exclusive branch assignment + lock guard ──────────────────────────────────

test('branch assignment service exposes an exclusive setter that deactivates other branches', () => {
  assert.match(branchAssignmentService, /export async function applyExclusiveBranchAssignmentTx/);
  assert.match(branchAssignmentService, /export async function setExclusiveBranchAssignment/);
  // Deactivates every OTHER active branch before activating the target as primary.
  assert.match(
    branchAssignmentService,
    /UPDATE user_branch_assignments[\s\S]*SET status = 'inactive'[\s\S]*WHERE user_id = \$1[\s\S]*AND branch_id <> \$2[\s\S]*AND status = 'active'/,
  );
});

test('manual branch mutations are locked for employee-linked accounts', () => {
  assert.match(branchAssignmentService, /'MANAGED_BY_EMPLOYEE'/);
  assert.match(branchAssignmentService, /async function assertAccountBranchIsManual/);
  assert.match(branchAssignmentService, /SELECT employee_id FROM hr_users WHERE id = \$1/);
  // Guard is invoked by all three manual mutations.
  assert.equal((branchAssignmentService.match(/assertAccountBranchIsManual\(client, /g) ?? []).length, 3);
});

// ── saveEmployeeSystemAccount: replace-not-add, fatal on failure ───────────────

test('account link forces the employee branch exclusively and fails hard, not silently', () => {
  assert.match(employeeService, /setExclusiveBranchAssignment\(\{\s*userId: savedRow\.id,\s*branchId: employee\.branchId,\s*\}\)/);
  // The old best-effort swallow must be gone.
  assert.doesNotMatch(employeeService, /Non-fatal.*branch assignment failure/);
  assert.doesNotMatch(employeeService, /upsertUserBranchAssignment/);
});

// ── transferEmployeeBranch ────────────────────────────────────────────────────

test('transfer blocks up front on open work outside the target branch', () => {
  assert.match(employeeService, /async function assertNoBlockingOpenWork/);
  // Non-terminal field visits the employee is responsible for.
  assert.match(
    employeeService,
    /FROM field_visits[\s\S]*team_responsible_user_id = ANY\(\$1::int\[\]\)[\s\S]*branch_id <> \$2[\s\S]*status NOT IN \('completed', 'not_completed', 'cancelled', 'closed'\)/,
  );
  // Non-closed tasks on personally-owned customers.
  assert.match(employeeService, /FROM open_tasks ot[\s\S]*ot\.status NOT IN \('completed', 'closed', 'cancelled'\)/);
  assert.match(employeeService, /personalOwnershipPredicate\('ot\.client_id'/);
  assert.match(employeeService, /throw createServiceError\(409/);
  // The guard runs before the transaction opens.
  assert.match(
    employeeService,
    /await assertNoBlockingOpenWork\(input\.employeeId, input\.toBranchId\)[\s\S]*const client = await pool\.connect\(\)/,
  );
});

test('transfer moves record + account together and nulls both manager sides', () => {
  assert.match(employeeService, /export async function transferEmployeeBranch/);
  assert.match(employeeService, /UPDATE employees SET branch_id = \$1, branch = \$2 WHERE id = \$3/);
  // Both directions of the direct-manager link are cleared.
  assert.match(employeeService, /UPDATE employees SET direct_manager_id = NULL WHERE id = \$1/);
  assert.match(employeeService, /UPDATE employees SET direct_manager_id = NULL WHERE direct_manager_id = \$1/);
  // Linked accounts get the exclusive branch inside the same transaction.
  assert.match(employeeService, /applyExclusiveBranchAssignmentTx\(client, accountId, input\.toBranchId\)/);
  // Audit row is written.
  assert.match(employeeService, /INSERT INTO employee_branch_transfers/);
  // Ownership is deliberately left as a footprint — no rewrite of contracts/clients.
  assert.doesNotMatch(employeeService, /UPDATE contracts SET sale_owner_id/);
});

// ── Route wiring ──────────────────────────────────────────────────────────────

test('transfer route authorizes on BOTH source and target branch', () => {
  assert.match(employeesRoute, /router\.post\('\/:id\/transfer-branch', requirePermission\('employees\.edit'\)/);
  assert.match(employeesRoute, /permission: 'employees\.edit', branchId: fromBranch/);
  assert.match(employeesRoute, /permission: 'employees\.edit', branchId: toBranchId/);
});

test('employee edit no longer moves the branch (transfer is the only path)', () => {
  assert.match(employeesRoute, /Branch is immutable on edit/);
  assert.match(employeesRoute, /const targetBranchId = ownerBranch;/);
});

// ── Migration 386 ─────────────────────────────────────────────────────────────

test('migration creates the audit table and reconciles employee-linked accounts', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.employee_branch_transfers/);
  assert.match(migration, /id\s+BIGSERIAL PRIMARY KEY/);
  // Deactivate non-employee-branch assignments for linked accounts only.
  assert.match(migration, /UPDATE public\.user_branch_assignments[\s\S]*SET status = 'inactive'[\s\S]*uba\.branch_id <> e\.branch_id/);
  // Ensure the employee branch is active + primary.
  assert.match(migration, /INSERT INTO public\.user_branch_assignments[\s\S]*ON CONFLICT \(user_id, branch_id\) DO UPDATE/);
  // Mirror into the legacy column.
  assert.match(migration, /UPDATE public\.hr_users u\s*SET branch_id = e\.branch_id/);
});
