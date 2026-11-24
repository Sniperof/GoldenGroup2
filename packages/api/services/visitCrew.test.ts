import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CrewValidationError,
  buildRequestedCrew,
  crewIdentity,
  effectiveCrew,
  incomingMembers,
  snapshotCrew,
  snapshotTeamType,
} from './visitCrew.js';
import type { TeamType } from './teamTypes.js';

const standard: TeamType = {
  id: 1, key: 'standard', name: 'فريق قياسي', description: null, isSystem: true, isActive: true, sortOrder: 10,
  slots: [
    { slotKey: 'supervisor', label: 'مشرف', slotFunction: 'lead', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [2] },
    { slotKey: 'technician', label: 'فني', slotFunction: 'field', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [4] },
    { slotKey: 'telemarketers', label: 'مسوقون', slotFunction: 'caller', countsOwnership: false, minMembers: 0, maxMembers: null, roleIds: [6] },
  ],
  taskTypes: [],
};
const collection: TeamType = {
  ...standard, id: 5, key: 'type_ab12cd34', name: 'فريق تحصيل', isSystem: false,
  slots: [
    { slotKey: 'collector', label: 'محصّل', slotFunction: 'lead', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [7] },
    { slotKey: 'driver', label: 'سائق', slotFunction: 'field', countsOwnership: false, minMembers: 0, maxMembers: 1, roleIds: [9] },
  ],
};

test('legacy snapshots read as typed crews', () => {
  assert.deepEqual(snapshotCrew({ teamKey: 'team_0', supervisorEmployeeId: 10, technicianEmployeeId: 11, telemarketerEmployeeIds: [20] }),
    { supervisor: [10], technician: [11], telemarketers: [20] });
  assert.equal(snapshotTeamType({ teamKey: 'solo_1', technicianEmployeeId: 30 }), 'emergency');
  assert.deepEqual(snapshotCrew({ teamKey: 'solo_1', technicianEmployeeId: 30 }), { technician: [30] });
  assert.deepEqual(snapshotCrew({ teamType: collection.key, members: { collector: [40], driver: [41] } }), { collector: [40], driver: [41] });
});

test('the typed replacement wins; legacy per-role replacement still applies', () => {
  const original = { teamKey: 'team_0', supervisorEmployeeId: 10, technicianEmployeeId: 11 };
  assert.deepEqual(effectiveCrew({ team_snapshot: original, reassigned_supervisor_id: null, reassigned_technician_id: 12 }),
    { supervisor: [10], technician: [12] });
  assert.deepEqual(effectiveCrew({
    team_snapshot: original,
    reassigned_team_snapshot: { members: { supervisor: [13], technician: [14] } },
    reassigned_supervisor_id: 13, reassigned_technician_id: 14,
  }), { supervisor: [13], technician: [14] });
});

test('a custom crew can replace its driver; callers are kept, not edited', () => {
  const original = { collector: [40], driver: [41] };
  const requested = buildRequestedCrew(collection, original, original, { collector: [40], driver: [42] });
  assert.deepEqual(requested, { collector: [40], driver: [42] });
  assert.deepEqual(incomingMembers(collection, original, requested).map(m => [m.id, m.slot.slotKey]), [[42, 'driver']]);

  const withCallers = buildRequestedCrew(standard, { supervisor: [10], technician: [11] }, { supervisor: [10], technician: [11], telemarketers: [20] },
    { supervisor: [10], technician: [12], telemarketers: [99] });
  assert.deepEqual(withCallers, { supervisor: [10], technician: [12], telemarketers: [20] });
});

test('a filled slot can be replaced but not emptied; bounds and duplicates hold', () => {
  const original = { collector: [40], driver: [41] };
  assert.throws(() => buildRequestedCrew(collection, original, original, { collector: [40] }), /لا يمكن إزالة سائق/);
  assert.throws(() => buildRequestedCrew(collection, original, original, { collector: [40], driver: [41, 43] }), /حد أقصى/);
  assert.throws(() => buildRequestedCrew(collection, original, original, { collector: [41], driver: [41] }), /أكثر من خانة/);
  assert.throws(() => buildRequestedCrew(collection, original, original, { collector: [40], helper: [1] }), CrewValidationError);
});

test('identity compares only the travelling slots', () => {
  assert.equal(
    crewIdentity(standard, { supervisor: [10], technician: [11], telemarketers: [20] }),
    crewIdentity(standard, { technician: [11], supervisor: [10] }),
  );
});
