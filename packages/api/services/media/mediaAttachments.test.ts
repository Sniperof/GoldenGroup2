import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_INLINE_GRACE,
  MAX_ATTACHMENTS_PER_FIELD,
  isAcceptedMediaUrl,
  validateMediaAttachments,
  validatePrimaryImageId,
} from './mediaAttachments.js';

const OK_URL = '/m/aB3xK9pQmN2v.webp';

test('accepts media-store and legacy upload URLs only', () => {
  assert.equal(isAcceptedMediaUrl(OK_URL), true);
  assert.equal(isAcceptedMediaUrl('/m/aB3xK9pQmN2v_t.webp'), true);
  assert.equal(isAcceptedMediaUrl('/uploads/123_photo.jpg'), true);

  assert.equal(isAcceptedMediaUrl('https://evil.example/x.png'), false);
  assert.equal(isAcceptedMediaUrl('//evil.example/x.png'), false);
  assert.equal(isAcceptedMediaUrl('/m/../../etc/passwd'), false);
  assert.equal(isAcceptedMediaUrl('/uploads/../secrets.env'), false);
});

test('inline base64 is rejected now that the migration has run', () => {
  assert.equal(LEGACY_INLINE_GRACE, false, 'grace should stay off once migrated');
  assert.equal(isAcceptedMediaUrl('data:image/png;base64,iVBORw0KGgo='), false);
  assert.throws(() => validateMediaAttachments(
    [{ id: 'a', name: 'x', url: 'data:image/png;base64,iVBORw0KGgo=' }],
    'الصور',
  ));
});

test('normalises a valid list and keeps the thumbnail', () => {
  const result = validateMediaAttachments(
    [{ id: 'a', name: '  front  ', url: OK_URL, thumbUrl: '/m/aB3xK9pQmN2v_t.webp' }],
    'الصور',
  );
  assert.deepEqual(result, [{
    id: 'a', name: 'front', url: OK_URL, thumbUrl: '/m/aB3xK9pQmN2v_t.webp',
  }]);
});

test('rejects malformed entries', () => {
  assert.throws(() => validateMediaAttachments('nope', 'الصور'));
  assert.throws(() => validateMediaAttachments([null], 'الصور'));
  assert.throws(() => validateMediaAttachments([{ name: 'x', url: OK_URL }], 'الصور'));      // no id
  assert.throws(() => validateMediaAttachments([{ id: 'a', name: 'x' }], 'الصور'));          // no url
  assert.throws(() => validateMediaAttachments(
    [{ id: 'a', name: 'x', url: OK_URL }, { id: 'a', name: 'y', url: OK_URL }], 'الصور',     // duplicate id
  ));
  assert.throws(() => validateMediaAttachments(
    Array.from({ length: MAX_ATTACHMENTS_PER_FIELD + 1 }, (_, i) => ({ id: `a${i}`, name: 'x', url: OK_URL })),
    'الصور',
  ));
});

test('empty and missing lists are both empty', () => {
  assert.deepEqual(validateMediaAttachments(undefined, 'الصور'), []);
  assert.deepEqual(validateMediaAttachments(null, 'الصور'), []);
  assert.deepEqual(validateMediaAttachments([], 'الصور'), []);
});

test('primary image must be one of the images present', () => {
  const images = validateMediaAttachments([{ id: 'a', name: 'x', url: OK_URL }], 'الصور');
  assert.equal(validatePrimaryImageId('a', images), 'a');
  assert.equal(validatePrimaryImageId('', images), null);
  assert.equal(validatePrimaryImageId(null, images), null);
  assert.throws(() => validatePrimaryImageId('missing', images));
  assert.throws(() => validatePrimaryImageId('a', []));
});
