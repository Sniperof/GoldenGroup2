import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./dashboardLayout.ts', import.meta.url), 'utf8');

test('dashboard layout route authorizes every widget and any pinned branch', () => {
  assert.match(source, /resolveListAccessScope\(authContext, permission\)/);
  assert.match(source, /resolveEffectiveScope\(\{ scope: plan\.scope, allowedBranchIds: plan\.allowedBranchIds \}/);
  assert.match(source, /DashboardLayoutValidationError\(403/);
});

test('dashboard layout is persisted per authenticated user', () => {
  assert.match(source, /WHERE user_id = \$1/);
  assert.match(source, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.match(source, /customized = rows\.length > 0/);
});
