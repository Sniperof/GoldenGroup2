import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectMobileServiceRequestMedia,
  VIDEO_MAX_DURATION_MS,
} from './mobileServiceRequestMedia.js';

function box(type: string, payload: Buffer) {
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, 'ascii');
  payload.copy(result, 8);
  return result;
}

function mp4(durationMs: number) {
  const ftyp = box('ftyp', Buffer.from('isom', 'ascii'));
  const mvhdPayload = Buffer.alloc(20);
  mvhdPayload[0] = 0;
  mvhdPayload.writeUInt32BE(1_000, 12);
  mvhdPayload.writeUInt32BE(durationMs, 16);
  return Buffer.concat([ftyp, box('moov', box('mvhd', mvhdPayload))]);
}

test('MP4 inspection derives duration from binary metadata', () => {
  assert.deepEqual(inspectMobileServiceRequestMedia(mp4(8_000)), {
    mediaType: 'video',
    mimeType: 'video/mp4',
    extension: '.mp4',
    durationMs: 8_000,
  });
  assert.equal(VIDEO_MAX_DURATION_MS, 8_000);
});

test('media inspection rejects extension-only or malformed MP4 input', () => {
  assert.equal(inspectMobileServiceRequestMedia(Buffer.from('video.mp4')), null);
});

test('media inspection accepts a PDF by binary signature and classifies it as a document', () => {
  assert.deepEqual(inspectMobileServiceRequestMedia(Buffer.from('%PDF-1.7\n1 0 obj\n')), {
    mediaType: 'document', mimeType: 'application/pdf', extension: '.pdf', durationMs: null,
  });
  assert.equal(inspectMobileServiceRequestMedia(Buffer.from('application.pdf')), null);
});
