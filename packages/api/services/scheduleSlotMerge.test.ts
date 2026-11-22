import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeScheduleSlots } from './scheduleSlotMerge.js';

// Branch A's editor. Employees 1xx belong to branch A, 2xx to branch B.
const visibleToA = (slot: any) => {
  const lead = slot?.supervisor ?? slot?.technician;
  return lead == null || lead < 200;
};
const A0 = { supervisor: 101, technician: 102 };
const B1 = { supervisor: 201, technician: 202 };
const A2 = { supervisor: 103, technician: 104 };
const LOCK = { locked: true };
const EMPTY = { supervisor: null, technician: null };

test('a locked placeholder at the stored index keeps the other branch\'s team', () => {
  const result = mergeScheduleSlots([A0, LOCK, A2], [A0, B1, A2], false, visibleToA);
  assert.equal(result.conflictIndex, null);
  assert.deepEqual(result.merged, [A0, B1, A2]);
});

test('removing a middle team by shifting the array is rejected, not a silent delete', () => {
  // Old UI: filter() removed A0 and shifted the placeholder to index 0.
  const result = mergeScheduleSlots([LOCK, A2], [A0, B1, A2], false, visibleToA);
  assert.equal(result.conflictIndex, 1);
});

test('clearing a team in place keeps every later index stable', () => {
  const result = mergeScheduleSlots([EMPTY, LOCK, A2], [A0, B1, A2], false, visibleToA);
  assert.equal(result.conflictIndex, null);
  assert.deepEqual(result.merged, [EMPTY, B1, A2]);
});

test('a payload without placeholders cannot wipe another branch\'s team', () => {
  const result = mergeScheduleSlots([A0], [A0, B1], false, visibleToA);
  assert.equal(result.conflictIndex, 1);
});

test('an own team cannot be written over a foreign position', () => {
  const result = mergeScheduleSlots([A0, A2], [A0, B1], false, visibleToA);
  assert.equal(result.conflictIndex, 1);
});

test('an own trailing team can be removed', () => {
  const result = mergeScheduleSlots([A0, LOCK], [A0, B1, A2], false, visibleToA);
  assert.equal(result.conflictIndex, null);
  assert.deepEqual(result.merged, [A0, B1]);
});

test('new own teams append after the stored row', () => {
  const result = mergeScheduleSlots([A0, LOCK, A2], [A0, B1], false, visibleToA);
  assert.equal(result.conflictIndex, null);
  assert.deepEqual(result.merged, [A0, B1, A2]);
});
