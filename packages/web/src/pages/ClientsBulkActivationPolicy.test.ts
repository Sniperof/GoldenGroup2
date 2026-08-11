import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('clients page separates selected activation from filtered-set activation', () => {
  const page = readFileSync(new URL('./Clients.tsx', import.meta.url), 'utf8');

  assert.match(page, /Number\(c\.governorate\) === governorateId/);
  assert.match(page, /تفعيل نتائج الفلاتر/);
  assert.match(page, /label: 'تفعيل حسابات المحددين'/);
  assert.match(page, /scope: 'selected'/);
  assert.match(page, /clients: items/);
  assert.doesNotMatch(page, /label: 'حذف'/);
});

test('selection and activation report stay explicit when filters or per-client outcomes change', () => {
  const table = readFileSync(new URL('../components/SmartTable.tsx', import.meta.url), 'utf8');
  const modal = readFileSync(
    new URL('../components/appAccounts/BulkActivateModal.tsx', import.meta.url),
    'utf8',
  );

  assert.match(table, /visibleIds\.has\(id\)/);
  assert.match(modal, /الزبائن المحددون يدوياً/);
  assert.match(modal, /جميع الزبائن المطابقين للفلاتر الحالية/);
  assert.match(modal, /skippedMissingCount/);
  assert.match(modal, /report\.skippedMissing/);
  assert.match(modal, /failedCount/);
  assert.match(modal, /report\.failed/);
});
