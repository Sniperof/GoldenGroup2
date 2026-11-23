import test from 'node:test';
import assert from 'node:assert/strict';
import { isPastPlanningDay, todayInDamascus } from './planningPastDayLock.js';

// 2026-11-22T22:30Z is already 2026-11-23 01:30 in Damascus (+03).
const lateNightUtc = new Date('2026-11-22T22:30:00Z');

test('today is taken from the Damascus calendar, not UTC', () => {
  assert.equal(todayInDamascus(lateNightUtc), '2026-11-23');
});

test('yesterday is locked, today and future days stay editable', () => {
  assert.equal(isPastPlanningDay('2026-11-22', lateNightUtc), true);
  assert.equal(isPastPlanningDay('2026-11-23', lateNightUtc), false);
  assert.equal(isPastPlanningDay('2026-11-24', lateNightUtc), false);
});
