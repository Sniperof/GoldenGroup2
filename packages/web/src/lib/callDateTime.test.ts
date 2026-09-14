import assert from 'node:assert/strict';
import test from 'node:test';
import { toCallInstant } from './callDateTime.js';

test('a zone-less local string becomes the instant the browser was sitting in', () => {
  const instant = toCallInstant('2026-08-06T15:03');
  assert.ok(instant);
  // Whatever the runner's zone is, the result must denote the same wall clock in it.
  const parsed = new Date(instant);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 7);
  assert.equal(parsed.getDate(), 6);
  assert.equal(parsed.getHours(), 15);
  assert.equal(parsed.getMinutes(), 3);
  // And it must carry its zone, so no reader has to assume one.
  assert.match(instant, /(?:Z|[+-]\d{2}:\d{2})$/);
});

test('a string that already names its zone is passed through untouched', () => {
  assert.equal(toCallInstant('2026-08-06T15:03:00+03:00'), '2026-08-06T15:03:00+03:00');
  assert.equal(toCallInstant('2026-08-06T12:03:00Z'), '2026-08-06T12:03:00Z');
});

test('nothing to send stays nothing, so the server falls back to its own clock', () => {
  assert.equal(toCallInstant(null), null);
  assert.equal(toCallInstant(undefined), null);
  assert.equal(toCallInstant('   '), null);
  assert.equal(toCallInstant('not a date'), null);
});
