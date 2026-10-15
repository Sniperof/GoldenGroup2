import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

test('task routes wait for a branch before their branch-only APIs mount', () => {
  const guardedRoutes = routes.match(
    /<Route element={<RequireBranchContext><Outlet \/><\/RequireBranchContext>}>([\s\S]*?)<\/Route>/,
  )?.[1];

  assert.ok(guardedRoutes, 'task route group must use the shared branch prompt');
  for (const path of routes.matchAll(/<Route path="(\/tasks\/[^\"]+|\/open-tasks)"/g)) {
    assert.ok(guardedRoutes.includes(`path="${path[1]}"`), `${path[1]} must be branch guarded`);
  }
});

test('visit screens using branch-only APIs share the prompt without gating general records', () => {
  for (const path of ['/field-visits', '/field-visits/:id', '/my-visits']) {
    assert.match(routes, new RegExp(`<Route path="${path}" element={<RequireBranchContext>`));
  }
  for (const path of ['/clients', '/clients/:id', '/service-requests']) {
    assert.doesNotMatch(routes, new RegExp(`<Route path="${path}" element={<RequireBranchContext>`));
  }
});
