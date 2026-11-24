import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAssignmentKey } from './routeAssignmentPolicy.js';

test('a full assignment key splits into date and team key', () => {
  assert.deepEqual(parseAssignmentKey('2026-11-26_team_12'), { date: '2026-11-26', teamKey: 'team_12' });
  assert.deepEqual(parseAssignmentKey('2026-11-26_solo_0'), { date: '2026-11-26', teamKey: 'solo_0' });
});

test('malformed keys are rejected', () => {
  assert.equal(parseAssignmentKey('2026-11-26_team_x'), null);
  assert.equal(parseAssignmentKey('dddd-dd-dd_team_1'), null);
  assert.equal(parseAssignmentKey('2026-11-26team_1'), null);
});
