import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ClientModal.tsx', import.meta.url), 'utf8');

test('candidate conversion requires a structured sub-area even when all geo ids are missing', () => {
  assert.match(
    source,
    /fromCandidate && !\(geoSelection\.subId \|\| geoSelection\.neighborhoodId\)/,
  );
  assert.match(source, /if \(\(!fromCandidate \|\| candidateGeoNeedsUpgrade\)/);
  assert.match(source, /عنوان الاسم المقترح غير كاف لإنشاء زبون/);
});

test('the geo picker stays editable while a historical candidate address needs completion', () => {
  assert.match(
    source,
    /disabled=\{fl\(initialData\?\.neighborhood\) && !candidateGeoNeedsUpgrade\}/,
  );
});
