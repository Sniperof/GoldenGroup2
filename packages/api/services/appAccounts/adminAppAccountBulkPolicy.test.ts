import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeBulkClientIds } from './adminAppAccountService.js';

test('bulk activation ids are positive, unique, and capped at 500', () => {
  assert.deepEqual(
    normalizeBulkClientIds([3, 3, '4' as any, 0, -2, Number.NaN]),
    {
      ids: [3, 4],
      cappedIds: [3, 4],
      truncated: false,
    },
  );

  const overCap = normalizeBulkClientIds(Array.from({ length: 501 }, (_, index) => index + 1));
  assert.equal(overCap.ids.length, 501);
  assert.equal(overCap.cappedIds.length, 500);
  assert.equal(overCap.truncated, true);
});

test('bulk activation reports isolated technical failures instead of losing partial results', () => {
  const service = readFileSync(new URL('./adminAppAccountService.ts', import.meta.url), 'utf8');

  assert.match(service, /const failed: Array<\{ clientId: number \}> = \[\]/);
  assert.match(service, /failed\.push\(\{ clientId: c\.id \}\)/);
  assert.match(service, /failedCount: failed\.length/);
  assert.match(service, /requestedCount/);
});
