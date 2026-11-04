import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTeamSnapshot,
  effectiveMembers,
  responsibleRole,
  sameMembers,
  TeamReassignmentError,
  teamKindOf,
  validateRequestedTeam,
} from './visitTeamReassignment.js';
import { teamChangeIsVisible } from './appNotifications/outboxConsumer.js';

const original = { supervisor: 1, technician: 2, trainee: null };

test('effective crew falls back to the original per role', () => {
  const visit = {
    team_snapshot: { teamKey: 'team_0', supervisorEmployeeId: 1, technicianEmployeeId: 2, traineeEmployeeId: 3 },
    reassigned_supervisor_id: null,
    reassigned_technician_id: 9,
    reassigned_trainee_id: null,
  };
  assert.deepEqual(effectiveMembers(visit), { supervisor: 1, technician: 9, trainee: 3 });
});

test('solo teams are recognised by their key and answered by the technician', () => {
  assert.equal(teamKindOf({ teamKey: 'solo_2' }), 'solo');
  assert.equal(teamKindOf({ teamKey: 'team_0' }), 'team');
  assert.equal(responsibleRole('solo'), 'technician');
  assert.equal(responsibleRole('team'), 'supervisor');
});

test('a standard team keeps a supervisor and a technician', () => {
  assert.throws(
    () => validateRequestedTeam('team', original, { supervisor: null, technician: 2, trainee: null }),
    (e: unknown) => e instanceof TeamReassignmentError && e.statusCode === 400 && /مشرفاً/.test(e.message),
  );
});

test('a solo team has a technician and no supervisor', () => {
  const solo = { supervisor: null, technician: 5, trainee: null };
  assert.throws(() => validateRequestedTeam('solo', solo, { supervisor: 7, technician: 5, trainee: null }), /لا يضم مشرفاً/);
  assert.doesNotThrow(() => validateRequestedTeam('solo', solo, { supervisor: null, technician: 6, trainee: null }));
});

test('a role of the original crew can be replaced but not emptied', () => {
  const withTrainee = { supervisor: 1, technician: 2, trainee: 3 };
  assert.throws(
    () => validateRequestedTeam('team', withTrainee, { supervisor: 1, technician: 2, trainee: null }),
    /لا يمكن إزالة المتدرب/,
  );
  assert.doesNotThrow(() => validateRequestedTeam('team', withTrainee, { supervisor: 1, technician: 2, trainee: 4 }));
});

test('one person cannot hold two roles', () => {
  assert.throws(() => validateRequestedTeam('team', original, { supervisor: 2, technician: 2, trainee: null }), /أكثر من دور/);
});

test('the stored snapshot keeps telemarketers and the key unless a day team was picked', () => {
  const snap = { teamKey: 'team_0', telemarketerEmployeeIds: [8] };
  const members = { supervisor: 1, technician: 9, trainee: null };
  assert.deepEqual(buildTeamSnapshot(snap, members, null), {
    teamKey: 'team_0', supervisorEmployeeId: 1, technicianEmployeeId: 9, traineeEmployeeId: null,
    telemarketerEmployeeIds: [8],
  });
  assert.equal(buildTeamSnapshot(snap, members, 'team_2').teamKey, 'team_2');
  assert.ok(sameMembers(members, { ...members }));
});

test('the customer is told only when the supervisor or technician changes', () => {
  const from = { supervisorEmployeeId: 1, technicianEmployeeId: 2, traineeEmployeeId: 3 };
  assert.equal(teamChangeIsVisible(from, { ...from, traineeEmployeeId: 4 }), false);
  assert.equal(teamChangeIsVisible(from, { ...from, technicianEmployeeId: 5 }), true);
  assert.equal(teamChangeIsVisible(from, { ...from, supervisorEmployeeId: 6 }), true);
});
