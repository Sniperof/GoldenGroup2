import assert from 'node:assert/strict';
import test from 'node:test';
import { createUiId } from './uiId.js';

test('createUiId uses randomUUID when the browser exposes it', () => {
  const expected = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(createUiId({ randomUUID: () => expected }), expected);
});

test('createUiId creates a UUID v4 with getRandomValues when randomUUID is unavailable', () => {
  const value = createUiId({
    getRandomValues: (bytes) => {
      bytes.fill(0xab);
      return bytes;
    },
  });

  assert.equal(value, 'abababab-abab-4bab-abab-abababababab');
});

test('createUiId still creates a UI key when Web Crypto is unavailable', () => {
  assert.match(createUiId(null), /^ui-[a-z0-9]+-[a-z0-9]+$/);
});
