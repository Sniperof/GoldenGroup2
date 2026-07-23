import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publicForm = readFileSync(new URL('./PublicJobs.tsx', import.meta.url), 'utf8');
const manualForm = readFileSync(new URL('./ManualApplicationEntry.tsx', import.meta.url), 'utf8');
const applicationsConstitution = readFileSync(
  new URL('../../../../../docs/constitution/features/Jobs & Recruitment Features/applications.md', import.meta.url),
  'utf8',
);

test('personal photo is optional in public and manual application forms', () => {
  assert.doesNotMatch(
    publicForm,
    /!applicant\.photoFile\s*&&\s*!applicant\.photoUrl/,
  );
  assert.match(
    publicForm,
    /<Field label="صورة شخصية \(PNG\/JPG، اختياري\)"/,
  );
  assert.match(
    manualForm,
    /<Field label="صورة شخصية" hint="اختياري"/,
  );
});

test('application constitution defines both attachments as optional', () => {
  assert.match(
    applicationsConstitution,
    /مرفقات اختيارية في النموذج العام والإدخال اليدوي/,
  );
});
