import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkPoints, decodePolyline, formatDistance, formatDuration } from './googleRoutes.js';

test('decodes Google\'s encoded polyline (reference example from the format spec)', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
});

test('long routes split into overlapping chunks of at most 12 points', () => {
  const pts = Array.from({ length: 21 }, (_, i) => i);
  const chunks = chunkPoints(pts);
  assert.ok(chunks.every(c => c.length <= 12));
  // Consecutive chunks share their joining point, and every point is covered in order.
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i][0], chunks[i - 1].at(-1));
  assert.deepEqual([...new Set(chunks.flat())], pts);
  // Every leg (pair of consecutive points) is in exactly one chunk.
  const legs = chunks.reduce((n, c) => n + c.length - 1, 0);
  assert.equal(legs, pts.length - 1);
});

test('short routes stay one request', () => {
  assert.equal(chunkPoints([1, 2, 3]).length, 1);
  assert.equal(chunkPoints(Array.from({ length: 12 }, (_, i) => i)).length, 1);
});

test('formats distance and drive time in Arabic units', () => {
  assert.equal(formatDistance(62_340), '62.3 كم');
  assert.equal(formatDistance(850), '850 م');
  assert.equal(formatDuration(4_800), '1 س 20 د');
  assert.equal(formatDuration(1_080), '18 د');
});
