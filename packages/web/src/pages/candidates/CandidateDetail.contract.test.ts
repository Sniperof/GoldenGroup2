import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./CandidateDetail.tsx', import.meta.url), 'utf8');

test('candidate status terminology follows the names table', () => {
  assert.match(source, /Junk: \{ label: 'مرفوض'/);
  assert.doesNotMatch(source, /Junk: \{ label: 'مستبعد'/);
});

test('candidate V2 shows persisted gift promises as a permission-gated read-only section', () => {
  assert.match(source, /hasPermission\('contract_gifts\.view'\)/);
  assert.match(source, /candidate\.id !== candidateId/);
  assert.match(source, /api\.gifts\.records\.list\(\{ candidateId \}\)/);
  assert.match(source, /title="وعود الهدايا"/);
  assert.match(source, /لا توجد وعود هدايا مسجلة لهذا الاسم أو لائحته/);
  assert.doesNotMatch(source, /GiftRecordActions/);
});

test('candidate detail no longer renders the old global deferral sentence', () => {
  assert.doesNotMatch(source, /وعود الهدايا.*ليست جزءاً من النسخة الأولى/);
});
