import test from 'node:test';
import assert from 'node:assert/strict';
import {
  legacyRoleView,
  nextTeamKey,
  normalizeDaySchedule,
  resolveTeam,
  serializeScheduledTeams,
} from './daySchedule.js';
import type { TeamType } from './teamTypes.js';

const standard: TeamType = {
  id: 1, key: 'standard', name: 'فريق قياسي', description: null, isSystem: true, isActive: true, sortOrder: 10,
  slots: [
    { slotKey: 'supervisor', label: 'مشرف', slotFunction: 'lead', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [2] },
    { slotKey: 'technician', label: 'فني', slotFunction: 'field', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [4] },
    { slotKey: 'telemarketers', label: 'مسوقون', slotFunction: 'caller', countsOwnership: false, minMembers: 0, maxMembers: null, roleIds: [6] },
  ],
  taskTypes: ['device_demo', 'installment_collection'],
};

const emergency: TeamType = {
  ...standard, id: 2, key: 'emergency', name: 'فريق طوارئ',
  slots: [
    { slotKey: 'technician', label: 'فني', slotFunction: 'lead', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [4] },
    { slotKey: 'telemarketers', label: 'مسوقون', slotFunction: 'caller', countsOwnership: false, minMembers: 0, maxMembers: null, roleIds: [6] },
  ],
  taskTypes: ['emergency_maintenance'],
};

const collection: TeamType = {
  ...standard, id: 5, key: 'type_ab12cd34', name: 'فريق تحصيل', isSystem: false,
  slots: [
    { slotKey: 'collector', label: 'محصّل', slotFunction: 'lead', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [7] },
    { slotKey: 'driver', label: 'سائق', slotFunction: 'field', countsOwnership: false, minMembers: 0, maxMembers: 2, roleIds: [9] },
    { slotKey: 'callers', label: 'مسوقون', slotFunction: 'caller', countsOwnership: false, minMembers: 0, maxMembers: null, roleIds: [6] },
  ],
  taskTypes: ['installment_collection'],
};

test('a legacy row keeps its positional keys and maps to the seeded types', () => {
  const teams = normalizeDaySchedule({
    teams: [
      { supervisor: 10, technician: 11, telemarketers: [20, 21], trainee: null },
      { supervisor: null, technician: null }, // cleared in place = removed
      { supervisor: 12, technician: '13', telemarketers: [] },
    ],
    solos: [{ technician: 30, telemarketers: [22] }],
  });
  assert.deepEqual(teams, [
    { key: 'team_0', teamType: 'standard', members: { supervisor: [10], technician: [11], telemarketers: [20, 21] } },
    { key: 'team_2', teamType: 'standard', members: { supervisor: [12], technician: [13] } },
    { key: 'solo_0', teamType: 'emergency', members: { technician: [30], telemarketers: [22] } },
  ]);
});

test('a new-shape row is read as is, without positional keys', () => {
  const teams = normalizeDaySchedule({
    teams: [
      { key: 'team_4', teamType: 'type_ab12cd34', members: { collector: [40], driver: ['41', 41, 0], callers: [] } },
      { key: 'solo_0', teamType: 'emergency', members: { technician: [30] } },
    ],
    solos: [],
  });
  assert.deepEqual(teams, [
    { key: 'team_4', teamType: 'type_ab12cd34', members: { collector: [40], driver: [41] } },
    { key: 'solo_0', teamType: 'emergency', members: { technician: [30] } },
  ]);
});

test('next key never reuses a number', () => {
  assert.equal(nextTeamKey([]), 'team_0');
  assert.equal(nextTeamKey(['team_0', 'team_3', 'solo_7']), 'team_4');
});

test('members are resolved by function, not by role name', () => {
  const [std] = normalizeDaySchedule({ teams: [{ supervisor: 10, technician: 11, telemarketers: [20] }] });
  const resolved = resolveTeam(std!, standard);
  assert.equal(resolved.leadEmployeeId, 10);
  assert.deepEqual(resolved.fieldEmployeeIds, [10, 11]);
  assert.deepEqual(resolved.ownerEmployeeIds, [10, 11]);
  assert.deepEqual(resolved.callerEmployeeIds, [20]);
  assert.deepEqual(resolved.memberEmployeeIds, [10, 11, 20]);

  const custom = resolveTeam(
    { key: 'team_4', teamType: collection.key, members: { collector: [40], driver: [41, 42], callers: [20] } },
    collection,
  );
  assert.equal(custom.leadEmployeeId, 40);
  assert.deepEqual(custom.fieldEmployeeIds, [40, 41, 42]);
  assert.deepEqual(custom.ownerEmployeeIds, [40], 'driver slot does not count ownership');
  assert.deepEqual(custom.allowedTaskTypes, ['installment_collection']);
});

test('the legacy role view reproduces the old snapshot shape for both seeded types', () => {
  const [std, solo] = normalizeDaySchedule({
    teams: [{ supervisor: 10, technician: 11, telemarketers: [20] }],
    solos: [{ technician: 30 }],
  });
  assert.deepEqual(legacyRoleView(resolveTeam(std!, standard)), { supervisor: 10, technician: 11, trainee: null, telemarketers: [20] });
  assert.deepEqual(legacyRoleView(resolveTeam(solo!, emergency)), { supervisor: null, technician: 30, trainee: null, telemarketers: [] });
  const custom = resolveTeam({ key: 'team_4', teamType: collection.key, members: { collector: [40] } }, collection);
  assert.deepEqual(legacyRoleView(custom), { supervisor: 40, technician: null, trainee: null, telemarketers: [] });
});

test('an unknown type resolves to an empty team instead of throwing', () => {
  const resolved = resolveTeam({ key: 'team_9', teamType: 'gone', members: { x: [1] } }, null);
  assert.equal(resolved.leadEmployeeId, null);
  assert.deepEqual(resolved.memberEmployeeIds, []);
});

test('serialization writes the new shape and empties solos', () => {
  const stored = serializeScheduledTeams([{ key: 'team_0', teamType: 'standard', members: { supervisor: [10], telemarketers: [] } }]);
  assert.deepEqual(stored, { teams: [{ key: 'team_0', teamType: 'standard', members: { supervisor: [10] } }], solos: [] });
});
