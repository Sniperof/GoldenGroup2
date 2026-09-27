import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('./telemarketing.ts', import.meta.url), 'utf8');
const workspace = readFileSync(
  new URL('../../web/src/pages/TelemarketerWorkspace.tsx', import.meta.url),
  'utf8',
);
const api = readFileSync(new URL('../../web/src/lib/api.ts', import.meta.url), 'utf8');

const endpoint = route.slice(
  route.indexOf("'/task-lists/:taskListId/items/:itemId/client-details'"),
  route.indexOf('// LEGACY endpoint'),
);

test('contextual client details require a list permission and the saved task-list subject', () => {
  assert.match(endpoint, /requirePermission\('telemarketing\.lists\.view', 'telemarketing\.lists\.view_device_demo'\)/);
  assert.match(endpoint, /verifyTaskListAccess\(req, res, taskListId, \{ allowClosed: true \}\)/);
  assert.match(endpoint, /loadTaskListItem\(pool, taskListId, itemId\)/);
  assert.match(endpoint, /item\.entity_type !== 'client'/);
});

test('restricted supervisors cannot pivot from an allowed row to another client', () => {
  assert.match(endpoint, /sibling\.task_list_id = \$1/);
  assert.match(endpoint, /sibling\.entity_id = \$2/);
  assert.match(endpoint, /task\.task_type = 'device_demo'/);
  assert.match(endpoint, /WHERE c\.id = \$1 AND c\.branch_id = \$2/);
});

test('workspace loads the selected client through its task-list item context', () => {
  assert.match(api, /clientDetails: \(taskListId: string, itemId: string\)/);
  assert.match(workspace, /api\.telemarketing\.clientDetails\(activeTaskList\.id, selectedCustomer\.primaryItem\.id\)/);
  assert.doesNotMatch(
    workspace.slice(workspace.indexOf('const listedSelectedClient'), workspace.indexOf('const updateWorkspaceClient')),
    /api\.clients\.get/,
  );
});
