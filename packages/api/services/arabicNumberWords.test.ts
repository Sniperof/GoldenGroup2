import test from 'node:test';
import assert from 'node:assert/strict';
import { arabicNumberWords, sypInWords } from './arabicNumberWords.js';

test('basic numbers', () => {
  assert.equal(arabicNumberWords(0), 'صفر');
  assert.equal(arabicNumberWords(7), 'سبعة');
  assert.equal(arabicNumberWords(12), 'اثنا عشر');
  assert.equal(arabicNumberWords(25), 'خمسة وعشرون');
  assert.equal(arabicNumberWords(100), 'مئة');
  assert.equal(arabicNumberWords(250), 'مئتان وخمسون');
});

test('thousands and millions', () => {
  assert.equal(arabicNumberWords(1000), 'ألف');
  assert.equal(arabicNumberWords(2000), 'ألفان');
  assert.equal(arabicNumberWords(3000), 'ثلاثة آلاف');
  assert.equal(arabicNumberWords(117000), 'مئة وسبعة عشر ألف');
  assert.equal(arabicNumberWords(150000), 'مئة وخمسون ألف');
  assert.equal(arabicNumberWords(1_000_000), 'مليون');
  assert.equal(arabicNumberWords(9_800_000), 'تسعة ملايين وثمانمئة ألف');
  assert.equal(arabicNumberWords(20_021_300), 'عشرون مليون وواحد وعشرون ألف وثلاثمئة');
});

test('currency wording', () => {
  assert.equal(sypInWords(40000), 'أربعون ألف ليرة سورية');
});
