import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./GiftPromiseInlinePanel.tsx', import.meta.url), 'utf8');

test('candidate and name-list promise creation selects a condition from the system list', () => {
  assert.match(source, /api\.gifts\.promiseConditions\.list\(\)/);
  assert.match(source, /conditionId: string/);
  assert.match(source, /<select[\s\S]*value=\{draft\.conditionId\}/);
  assert.doesNotMatch(source, /value=\{draft\.conditionLabel\}/);
});
