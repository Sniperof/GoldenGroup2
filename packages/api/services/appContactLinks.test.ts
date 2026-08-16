import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAppContactLinksInput,
  toPublicAppContactLinks,
  type AppContactLinks,
} from './appContactLinks.js';

const valid = {
  facebookUrl: 'https://www.facebook.com/goldengroup',
  websiteUrl: 'https://golden.example/contact',
  instagramUrl: 'https://instagram.com/goldengroup',
  whatsappNumber: '+963 912-345-687',
  telegramNumber: '+963912345687',
};

test('normalizes the complete app-contact-links payload', () => {
  assert.deepEqual(normalizeAppContactLinksInput(valid), {
    ...valid,
    facebookUrl: 'https://www.facebook.com/goldengroup',
    websiteUrl: 'https://golden.example/contact',
    instagramUrl: 'https://instagram.com/goldengroup',
    whatsappNumber: '+963912345687',
  });
});

test('accepts null or blank values as hidden platforms', () => {
  const result = normalizeAppContactLinksInput({
    facebookUrl: null,
    websiteUrl: '',
    instagramUrl: '   ',
    whatsappNumber: null,
    telegramNumber: '',
  });
  assert.deepEqual(result, {
    facebookUrl: null,
    websiteUrl: null,
    instagramUrl: null,
    whatsappNumber: null,
    telegramNumber: null,
  });
});

test('rejects missing or unknown fields in the full replacement payload', () => {
  assert.throws(() => normalizeAppContactLinksInput({ ...valid, websiteUrl: undefined }), /./);
  assert.throws(() => normalizeAppContactLinksInput({ ...valid, extra: 'value' }), /./);
});

test('rejects non-HTTPS, credential-bearing and wrong-platform URLs', () => {
  assert.throws(() => normalizeAppContactLinksInput({ ...valid, websiteUrl: 'http://golden.example' }), /./);
  assert.throws(() => normalizeAppContactLinksInput({ ...valid, websiteUrl: 'https://user:pass@golden.example' }), /./);
  assert.throws(() => normalizeAppContactLinksInput({ ...valid, facebookUrl: 'https://instagram.com/golden' }), /./);
  assert.throws(() => normalizeAppContactLinksInput({ ...valid, instagramUrl: 'https://facebook.com/golden' }), /./);
});

test('accepts E.164 phone numbers and rejects invalid numbers', () => {
  assert.equal(normalizeAppContactLinksInput(valid).whatsappNumber, '+963912345687');
  for (const phone of ['963912345687', '+0123456789', '+96312', '+963-abc']) {
    assert.throws(() => normalizeAppContactLinksInput({ ...valid, telegramNumber: phone }), /./);
  }
});

test('public projection keeps stable keys and maps hidden values to null', () => {
  const row: AppContactLinks = {
    facebookUrl: 'https://facebook.com/golden',
    websiteUrl: null,
    instagramUrl: null,
    whatsappNumber: '+963912345687',
    telegramNumber: null,
    updatedAt: '2026-08-16T12:00:00.000Z',
  };
  assert.deepEqual(toPublicAppContactLinks(row), {
    links: {
      facebook: { kind: 'url', value: 'https://facebook.com/golden' },
      website: null,
      instagram: null,
      whatsapp: { kind: 'phone', value: '+963912345687' },
      telegram: null,
    },
    updatedAt: row.updatedAt,
  });
});
