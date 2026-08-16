import assert from 'node:assert/strict';
import test from 'node:test';
import { hitRateLimit, resetRateLimitState } from './rateLimit.js';

test('allows exactly `limit` calls inside the window, then blocks', () => {
  resetRateLimitState();
  const now = 1_000_000;
  for (let i = 0; i < 3; i += 1) {
    assert.equal(hitRateLimit('k', 3, 60, now).allowed, true, `call ${i + 1}`);
  }
  const blocked = hitRateLimit('k', 3, 60, now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
});

test('the window reopens once it elapses', () => {
  resetRateLimitState();
  const now = 2_000_000;
  hitRateLimit('k', 1, 60, now);
  assert.equal(hitRateLimit('k', 1, 60, now).allowed, false);
  assert.equal(hitRateLimit('k', 1, 60, now + 60_001).allowed, true);
});

test('retryAfter counts down within the window', () => {
  resetRateLimitState();
  const now = 3_000_000;
  hitRateLimit('k', 1, 100, now);
  assert.equal(hitRateLimit('k', 1, 100, now + 40_000).retryAfterSeconds, 60);
});

test('different keys never share a window', () => {
  resetRateLimitState();
  const now = 4_000_000;
  hitRateLimit('a', 1, 60, now);
  assert.equal(hitRateLimit('a', 1, 60, now).allowed, false);
  assert.equal(hitRateLimit('b', 1, 60, now).allowed, true);
});

test('a limit of 0 disables the check', () => {
  resetRateLimitState();
  for (let i = 0; i < 100; i += 1) {
    assert.equal(hitRateLimit('off', 0, 60, 5_000_000).allowed, true);
  }
});
