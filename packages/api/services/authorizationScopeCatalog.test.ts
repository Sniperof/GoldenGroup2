import assert from 'node:assert/strict';
import test from 'node:test';
import { isPermissionGrantScopeAllowed } from './authorizationService.js';

test('stored grants are accepted only when their scope exists in the permission catalog', () => {
  assert.equal(isPermissionGrantScopeAllowed('BRANCH', ['GLOBAL', 'BRANCH']), true);
  assert.equal(isPermissionGrantScopeAllowed('ASSIGNED', ['GLOBAL', 'BRANCH']), false);
  assert.equal(isPermissionGrantScopeAllowed('GLOBAL', null), false);
  assert.equal(isPermissionGrantScopeAllowed('GLOBAL', ['UNKNOWN']), false);
});
