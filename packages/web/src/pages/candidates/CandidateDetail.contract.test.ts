import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./CandidateDetail.tsx', import.meta.url), 'utf8');

test('candidate status terminology follows the names table', () => {
  assert.match(source, /Junk: \{ label: 'مرفوض'/);
  assert.doesNotMatch(source, /Junk: \{ label: 'مستبعد'/);
});

test('candidate V2 delegates persisted gift promises to the shared details panel', () => {
  assert.match(source, /hasPermission\('contract_gifts\.view'\)/);
  assert.match(source, /ReferralGiftPromisesPanel/);
  assert.match(source, /candidateId=\{candidateId\}/);
  assert.match(source, /title="وعود الهدايا"/);
  assert.match(source, /لا توجد وعود هدايا مسجلة لهذا الاسم أو لائحته/);
  assert.doesNotMatch(source, /GiftRecordActions/);
  assert.doesNotMatch(source, /إضافة وعد هدية/);
});

test('candidate detail no longer renders the old global deferral sentence', () => {
  assert.doesNotMatch(source, /وعود الهدايا.*ليست جزءاً من النسخة الأولى/);
});
