import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeScheduledTeams } from './scheduleSlotMerge.js';
import type { ScheduledTeam } from './daySchedule.js';

// Branch A's editor. Employees 1xx belong to branch A, 2xx to branch B.
const team = (key: string, lead: number, extra: Record<string, number[]> = {}): ScheduledTeam =>
  ({ key, teamType: 'standard', members: { supervisor: [lead], ...extra } });
const visibleToA = (t: ScheduledTeam) => (t.members.supervisor?.[0] ?? 0) < 200;

const A0 = team('team_0', 101, { technician: [102] });
const B1 = team('team_1', 201, { technician: [202] });
const A2 = team('team_2', 103, { technician: [104] });

test('a foreign team is restored from the stored row even when the payload omits it', () => {
  const result = mergeScheduledTeams([A0, A2], [A0, B1, A2], visibleToA);
  assert.equal(result.conflictKey, null);
  assert.deepEqual(result.merged, [A0, B1, A2]);
});

test('removing a middle own team keeps every other key', () => {
  const result = mergeScheduledTeams([A2], [A0, B1, A2], visibleToA);
  assert.equal(result.conflictKey, null);
  assert.deepEqual(result.merged.map(t => t.key), ['team_1', 'team_2']);
});

test('an own team cannot be written under a foreign key', () => {
  const result = mergeScheduledTeams([A0, team('team_1', 105)], [A0, B1], visibleToA);
  assert.equal(result.conflictKey, 'team_1');
});

test('an own team can be edited in place', () => {
  const edited = team('team_0', 101, { technician: [106] });
  const result = mergeScheduledTeams([edited], [A0, B1], visibleToA);
  assert.deepEqual(result.merged, [edited, B1]);
});

test('new own teams append after the stored row', () => {
  const A3 = team('team_3', 107);
  const result = mergeScheduledTeams([A0, A3], [A0, B1], visibleToA);
  assert.equal(result.conflictKey, null);
  assert.deepEqual(result.merged, [A0, B1, A3]);
});
