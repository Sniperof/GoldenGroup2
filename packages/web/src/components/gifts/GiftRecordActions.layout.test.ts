import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actionsSource = readFileSync(new URL('./GiftRecordActions.tsx', import.meta.url), 'utf8');
const tableSource = readFileSync(new URL('./GiftRecordsTable.tsx', import.meta.url), 'utf8');

test('gift row exposes every permitted operation through one action menu', () => {
  assert.match(actionsSource, /<Select<ActionMenuValue \| ''>/);
  assert.match(actionsSource, /placeholder="الإجراءات"/);
  assert.match(actionsSource, /value: 'contract'/);
  assert.match(actionsSource, /value: 'condition'/);
  assert.match(actionsSource, /value: 'approve'/);
  assert.match(actionsSource, /value: 'cancel'/);
  assert.doesNotMatch(actionsSource, /function ActionButton/);
});

test('gift table renders one action control instead of a vertical button stack', () => {
  assert.match(tableSource, /<GiftRecordActions/);
  assert.doesNotMatch(tableSource, /flex flex-col gap-2/);
  assert.doesNotMatch(tableSource, /<Link/);
});

test('gift records table hides responsibility metadata without changing its data contract', () => {
  assert.doesNotMatch(tableSource, />المسؤولية</);
  assert.doesNotMatch(tableSource, /record\.responsibleBranchName|record\.beneficiaryOwnershipLabel/);
});
