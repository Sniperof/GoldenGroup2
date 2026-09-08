import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ReferralGiftPromisesPanel.tsx', import.meta.url), 'utf8');

test('referral promise details load persisted candidate or name-list records', () => {
  assert.match(source, /api\.gifts\.records\.list\(query\)/);
  assert.match(source, /candidateId \? \{ candidateId \}/);
  assert.match(source, /referralSheetId \? \{ referralSheetId \}/);
});

test('details expose edit only for an editable unmaterialized referral promise', () => {
  assert.match(source, /record\.status !== 'promised'/);
  assert.match(source, /source\.sourceType === 'contract'/);
  assert.match(source, /source\.sourceType === 'name_list'/);
  assert.match(source, /source\.sourceType === 'candidate'/);
  assert.match(source, /updateReferralPromise/);
  assert.match(source, /api\.gifts\.promiseConditions\.list\(\)/);
  assert.match(source, /conditionId: Number\(conditionId\)/);
  assert.doesNotMatch(source, /setConditionLabel/);
  assert.doesNotMatch(source, /records\.create/);
  assert.doesNotMatch(source, /إضافة وعد/);
});
