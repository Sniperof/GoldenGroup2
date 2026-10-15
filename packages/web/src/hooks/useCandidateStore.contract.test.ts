import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./useCandidateStore.ts', import.meta.url), 'utf8');

test('candidate conversion does not reject a missing historical referral date', () => {
  assert.doesNotMatch(source, /!candidate\.referralDate\s*\|\|\s*!candidate\.referralType/);
  assert.doesNotMatch(source, /يفتقر إلى بيانات وتاريخ الاستقطاب الأساسية/);
  assert.match(source, /if \(!candidate\.referralType\)/);
});

test('candidate conversion remains server-authoritative and atomic', () => {
  assert.match(source, /sourceCandidateId: candidate\.id/);
  assert.doesNotMatch(source, /await api\.candidates\.update\([^)]*Qualified/);
});
