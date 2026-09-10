import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('clients page defers filter-only catalog requests until the filter panel opens', () => {
  const page = readFileSync(new URL('./Clients.tsx', import.meta.url), 'utf8');
  const guardedRequests = [
    'api.admin.hrUsers.nameListAssignable',
    'api.admin.taskTypes.list',
    'api.geoUnits.list',
    'api.routes.list',
    'api.systemLists.list',
  ];

  for (const request of guardedRequests) {
    const requestIndex = page.indexOf(request);
    assert.notEqual(requestIndex, -1, `${request} must remain present`);
    const effectStart = page.lastIndexOf('useEffect(() => {', requestIndex);
    const guardIndex = page.indexOf('if (!filtersOpen) return;', effectStart);
    assert.ok(
      effectStart >= 0 && guardIndex > effectStart && guardIndex < requestIndex,
      `${request} must be guarded by filtersOpen in its effect`,
    );
  }

  assert.match(page, /api\.geoUnits\.names\(\)/, 'row address labels still load initially');
  assert.match(page, /\}, \[filtersOpen, isGlobalClients, branchContextId\]\);/);
  assert.match(page, /\}, \[filtersOpen\]\);/);
});
