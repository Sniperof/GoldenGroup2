import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./AddCandidateModal.tsx', import.meta.url), 'utf8');

test('candidate save closes the same-tick double-click window until the request settles', () => {
  const saveHandler = source.slice(source.indexOf('const handleSave = async'), source.indexOf('const resetAndClose'));
  assert.match(saveHandler, /if \(saveInFlightRef\.current\) return;/);
  assert.match(saveHandler, /saveInFlightRef\.current = true;[\s\S]*setIsSaving\(true\);/);
  assert.match(saveHandler, /await addCandidate\(newC as any\)/);
  assert.match(saveHandler, /finally \{[\s\S]*saveInFlightRef\.current = false;[\s\S]*setIsSaving\(false\);/);
});

test('all modal exit and save actions are disabled or blocked while saving', () => {
  assert.match(source, /onClose=\{\(\) => \{ if \(!saveInFlightRef\.current\) resetAndClose\(\); \}\}/);
  assert.ok((source.match(/disabled=\{isSaving\}/g) ?? []).length >= 3);
  assert.match(source, /جارٍ الحفظ\.\.\./);
  assert.match(source, /animate-spin/);
});
