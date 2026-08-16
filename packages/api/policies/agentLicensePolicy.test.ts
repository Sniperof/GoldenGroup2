import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext } from '@golden-crm/shared';
import { hasAgentLicenseGlobalPermission } from './agentLicensePolicy.js';

function context(grants: AuthContext['grants'], isSuperAdmin = false): AuthContext {
  return { userId: 7, roleId: 3, isSuperAdmin, grants, allowedBranchIds: [2], actingBranchId: 2 };
}

test('agent-license policy allows an explicit GLOBAL grant', () => {
  assert.equal(hasAgentLicenseGlobalPermission(context([
    { permission: 'agent_license.view', scope: 'GLOBAL' },
  ]), 'agent_license.view'), true);
});

test('agent-license policy denies missing permission, wrong branch scope, and unassigned scope', () => {
  assert.equal(hasAgentLicenseGlobalPermission(context([]), 'agent_license.view'), false);
  assert.equal(hasAgentLicenseGlobalPermission(context([
    { permission: 'agent_license.view', scope: 'BRANCH' },
  ]), 'agent_license.view'), false);
  assert.equal(hasAgentLicenseGlobalPermission(context([
    { permission: 'agent_license.view', scope: 'ASSIGNED' },
  ]), 'agent_license.view'), false);
});

test('agent-license policy preserves the explicit super-admin path', () => {
  assert.equal(hasAgentLicenseGlobalPermission(context([], true), 'agent_license.decide'), true);
});
