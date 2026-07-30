import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DIRECT_MANAGER_BRANCH_FALLBACK_PERMISSION,
  DIRECT_MANAGER_ELIGIBILITY_PERMISSION,
  buildScopedEmployeeManagerCandidatesQuery,
} from '../repositories/employeeManagerCandidateQuery.js';

test('manager candidates are selected by explicit role eligibility grants inside the employee branch', () => {
  const query = buildScopedEmployeeManagerCandidatesQuery(6, 21);

  assert.deepEqual(query.values, [
    6,
    21,
    DIRECT_MANAGER_ELIGIBILITY_PERMISSION,
    DIRECT_MANAGER_BRANCH_FALLBACK_PERMISSION,
  ]);
  assert.match(query.text, /WHERE e\.branch_id = \$1/);
  assert.match(query.text, /JOIN hr_users u ON u\.employee_id = e\.id AND u\.is_active = TRUE/);
  assert.match(query.text, /AND e\.status = 'active'/);
  assert.match(query.text, /FROM role_permission_grants department_manager_rpg/);
  assert.match(query.text, /department_manager_p\.key = \$3/);
  assert.match(query.text, /FROM role_permission_grants branch_fallback_rpg/);
  assert.match(query.text, /branch_fallback_p\.key = \$4/);
  assert.match(
    query.text,
    /department_manager_p\.key = \$3[\s\S]*AND \(\$2::int IS NULL OR e\.department_id = \$2\)[\s\S]*OR EXISTS[\s\S]*branch_fallback_p\.key = \$4/,
  );
  assert.doesNotMatch(query.text, /ILIKE|LOWER\(COALESCE\(r\.name|branch_manager/i);
});

test('same-department candidates stay ranked before a cross-department branch manager', () => {
  const query = buildScopedEmployeeManagerCandidatesQuery(6, 21);

  assert.match(
    query.text,
    /\(\$2::int IS NOT NULL AND e\.department_id = \$2\) AS "isRecommendedManager"/,
  );
  assert.match(query.text, /ORDER BY\s+"isRecommendedManager" DESC,\s+e\.name ASC/);
});

test('manager candidate lookup preserves the existing no-department behavior', () => {
  const query = buildScopedEmployeeManagerCandidatesQuery(6);

  assert.deepEqual(query.values, [
    6,
    null,
    DIRECT_MANAGER_ELIGIBILITY_PERMISSION,
    DIRECT_MANAGER_BRANCH_FALLBACK_PERMISSION,
  ]);
});

test('permission migration registers both eligibility keys and only the intended baseline roles', () => {
  const migration = readFileSync(
    new URL('../../../migrations/385_employee_direct_manager_eligibility.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /'employees\.direct_manager_eligible'/);
  assert.match(migration, /'employees\.direct_manager_branch_fallback'/);
  assert.match(
    migration,
    /\('company_manager', 'employees\.direct_manager_eligible', 'GLOBAL'\)/,
  );
  assert.match(
    migration,
    /\('branch_manager', 'employees\.direct_manager_branch_fallback', 'BRANCH'\)/,
  );
  assert.equal(
    (migration.match(/ARRAY\['GLOBAL','BRANCH'\]/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(migration, /direct_manager_[\s\S]*ARRAY\[[^\]]*'ASSIGNED'/);
  assert.doesNotMatch(migration, /\('tech',|'supervisior'/);
});

test('both role administration surfaces explain the eligibility permissions', () => {
  const permissionSettings = readFileSync(
    new URL('../../web/src/pages/admin/PermissionSettings.tsx', import.meta.url),
    'utf8',
  );
  const rolePermissions = readFileSync(
    new URL('../../web/src/pages/admin/RolePermissions.tsx', import.meta.url),
    'utf8',
  );

  for (const source of [permissionSettings, rolePermissions]) {
    assert.match(source, /employees\.direct_manager_eligible/);
    assert.match(source, /employees\.direct_manager_branch_fallback/);
  }
});

test('save validation shares the scoped candidate source and describes the fallback accurately', () => {
  const service = readFileSync(new URL('./employeeService.ts', import.meta.url), 'utf8');

  assert.match(
    service,
    /const managerCandidates = await listScopedEmployeeManagerCandidates\(branchId, departmentId\)/,
  );
  assert.match(service, /لا يمكن أن يكون الموظف مديراً مباشراً لنفسه/);
  assert.match(
    service,
    /يجب اختيار المدير المباشر من مدراء القسم أو مدير الفرع المعتمد ضمن نفس الفرع/,
  );
  assert.match(service, /if \(managerBranchId !== branchId\)/);
});
