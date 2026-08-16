import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePublicAreaParentId,
  parsePublicAreaSearchLimit,
  parsePublicAreaSearchQuery,
} from './publicAreas.js';

test('public area query parsers accept valid bounded values', () => {
  assert.equal(parsePublicAreaParentId(undefined), null);
  assert.equal(parsePublicAreaParentId('248'), 248);
  assert.equal(parsePublicAreaSearchQuery('  المزة  '), 'المزة');
  assert.equal(parsePublicAreaSearchLimit(undefined), 15);
  assert.equal(parsePublicAreaSearchLimit('20'), 20);
});

test('public area query parsers reject malformed or abusive values', () => {
  assert.throws(() => parsePublicAreaParentId('1 OR 1=1'), (error: any) => error.status === 400);
  assert.throws(() => parsePublicAreaParentId(['1', '2']), (error: any) => error.status === 400);
  assert.throws(() => parsePublicAreaSearchQuery('م'), (error: any) => error.status === 400);
  assert.throws(() => parsePublicAreaSearchQuery('x'.repeat(81)), (error: any) => error.status === 400);
  assert.throws(() => parsePublicAreaSearchLimit('21'), (error: any) => error.status === 400);
});
