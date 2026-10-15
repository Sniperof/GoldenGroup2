import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modal = readFileSync(new URL('./InstantVisitModal.tsx', import.meta.url), 'utf8');

test('instant visit modal uses the operation-specific eligible customer lookup', () => {
  assert.match(modal, /api\.fieldVisits\.instantVisitOptions\(query, controller\.signal\)/);
  assert.doesNotMatch(modal, /api\.clients\.list/);
  assert.match(modal, /الزبائن المؤهلون ضمن مسار فريقك اليوم فقط/);
});

test('instant visit modal explains unavailable planning context before creation', () => {
  assert.match(modal, /الزيارة الفورية غير متاحة الآن/);
  assert.match(modal, /disabled={selectedId == null \|\| submitting \|\| unavailableReason != null}/);
});
