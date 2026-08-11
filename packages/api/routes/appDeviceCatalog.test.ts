import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePublicCatalogPagination } from './appDeviceCatalog.js';

test('mobile device catalog pagination defaults to a 12-item first page', () => {
  assert.deepEqual(
    parsePublicCatalogPagination(undefined, undefined),
    { value: { page: 1, limit: 12 }, error: null },
  );
});

test('mobile device catalog pagination accepts its documented boundaries', () => {
  assert.deepEqual(
    parsePublicCatalogPagination('3', '50'),
    { value: { page: 3, limit: 50 }, error: null },
  );
});

test('mobile device catalog pagination rejects invalid page and limit values', () => {
  for (const [page, limit] of [
    ['0', undefined],
    ['1.5', undefined],
    [undefined, '0'],
    [undefined, '51'],
    [undefined, 'many'],
  ] as Array<[string | undefined, string | undefined]>) {
    const result = parsePublicCatalogPagination(page, limit);
    assert.equal(result.value, null);
    assert.ok(result.error);
  }
});
