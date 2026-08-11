import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./AddCandidateModal.tsx', import.meta.url), 'utf8');

test('sheet mode loads its own authorized list and exposes failures instead of an empty dropdown', () => {
  assert.match(source, /api\.referralSheets\.list\(branchFilter\)/);
  assert.match(source, /setSheetsLoadError/);
  assert.match(source, /إعادة المحاولة/);
  assert.match(source, /لا توجد لائحة جديدة أو قيد الجمع ضمن نطاقك/);
});

test('sheet mode neither renders nor submits candidate ownership controls', () => {
  assert.match(source, /\{isDirectMode && \(canChooseBranch \|\| canChooseAssignedOwner\) && \(/);
  assert.match(source, /ownershipType: isDirectMode && canChooseAssignedOwner/);
  assert.match(source, /responsibleUserId: isDirectMode && canChooseAssignedOwner/);
  assert.match(source, /if \(isDirectMode && canChooseAssignedOwner/);
});
