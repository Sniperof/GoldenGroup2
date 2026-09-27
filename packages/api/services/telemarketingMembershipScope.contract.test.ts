import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scope = readFileSync(new URL('./telemarketingScope.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../routes/telemarketing.ts', import.meta.url), 'utf8');
const workspace = readFileSync(
  new URL('../../web/src/pages/TelemarketerWorkspace.tsx', import.meta.url),
  'utf8',
);

test('task-list subject access depends on permission context and saved team membership, not employee role text', () => {
  const accessFunction = scope.slice(
    scope.indexOf('export async function canAccessTaskList'),
    scope.indexOf('export async function canGenerateForTeam'),
  );
  assert.doesNotMatch(accessFunction, /getCurrentEmployeeRole|employeeRole/);
  assert.match(accessFunction, /isEmployeeSupervisorInTeam\(employeeId, team\)/);
  assert.match(accessFunction, /accessIds\.includes\(employeeId\)/);
});

test('snapshot computes accessible teams from membership and returns team options', () => {
  assert.doesNotMatch(route, /getCurrentEmployeeRole/);
  assert.match(route, /isEmployeeSupervisorInTeam\(employeeId, team\) \|\| accessIds\.includes\(employeeId\)/);
  assert.match(route, /availableTeams/);
});

test('telemarketer workspace no longer reads the planning-management schedule endpoint', () => {
  assert.doesNotMatch(workspace, /api\.schedules\.get/);
  assert.match(workspace, /availableTeams, loadData/);
});
