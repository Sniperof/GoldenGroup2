import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import {
  canAccessDevicePossession,
  type DevicePossessionPermission,
} from './devicePossessionPolicy.js';

function context(options: {
  permission?: DevicePossessionPermission;
  scope?: ScopeType;
  allowedBranchIds?: number[];
  isSuperAdmin?: boolean;
}): AuthContext {
  return {
    userId: 17,
    roleId: 4,
    isSuperAdmin: options.isSuperAdmin === true,
    actingBranchId: 2,
    allowedBranchIds: options.allowedBranchIds ?? [2],
    grants: options.permission && options.scope
      ? [{ permission: options.permission, scope: options.scope }]
      : [],
  };
}

test('device possession denies missing permission and a wrong branch', () => {
  for (const permission of [
    'installed_devices.possession.view',
    'installed_devices.possession.manage',
  ] satisfies DevicePossessionPermission[]) {
    assert.equal(
      canAccessDevicePossession(context({}), permission, { branchId: 2 }).allowed,
      false,
    );

    assert.equal(
      canAccessDevicePossession(
        context({ permission, scope: 'BRANCH', allowedBranchIds: [2] }),
        permission,
        { branchId: 9 },
      ).allowed,
      false,
    );
  }
});

test('device possession allows its branch, GLOBAL, and super-admin access', () => {
  for (const permission of [
    'installed_devices.possession.view',
    'installed_devices.possession.manage',
  ] satisfies DevicePossessionPermission[]) {
    assert.equal(
      canAccessDevicePossession(
        context({ permission, scope: 'BRANCH', allowedBranchIds: [2] }),
        permission,
        { branchId: 2 },
      ).allowed,
      true,
    );

    assert.equal(
      canAccessDevicePossession(
        context({ permission, scope: 'GLOBAL' }),
        permission,
        { branchId: 9 },
      ).allowed,
      true,
    );

    assert.equal(
      canAccessDevicePossession(
        context({ isSuperAdmin: true }),
        permission,
        { branchId: 9 },
      ).allowed,
      true,
    );
  }
});

test('device possession rejects unsupported ASSIGNED grants', () => {
  assert.equal(
    canAccessDevicePossession(
      context({
        permission: 'installed_devices.possession.view',
        scope: 'ASSIGNED',
      }),
      'installed_devices.possession.view',
      { branchId: 2 },
    ).allowed,
    false,
  );
});
