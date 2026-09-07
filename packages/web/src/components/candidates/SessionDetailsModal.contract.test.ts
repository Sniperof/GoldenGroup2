import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./SessionDetailsModal.tsx', import.meta.url), 'utf8');

test('name-list details show persisted gifts without a local add flow', () => {
  assert.match(source, /ReferralGiftPromisesPanel/);
  assert.match(source, /referralSheetId=\{sheet\.id\}/);
  assert.match(source, /hasPermission\('contract_gifts\.view'\)/);
  assert.doesNotMatch(source, /sheetGiftPromises/);
  assert.doesNotMatch(source, /إضافة وعد هدية/);
});
