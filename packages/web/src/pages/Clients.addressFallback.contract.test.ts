import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./Clients.tsx', import.meta.url), 'utf8');

test('client rows fall back to the detailed address when structured geo is absent', () => {
  assert.match(source, /const getClientAddressLabel = \(client: Client\)/);
  assert.match(source, /return client\.detailedAddress\?\.trim\(\) \|\| '--'/);
  assert.match(source, /\{getClientAddressLabel\(c\)\}/);
});

test('occupation column displays occupation rather than duplicating the address', () => {
  assert.match(source, /key: 'occupation', label: 'المهنة'/);
  assert.match(source, /\{c\.occupation \|\| '--'\}/);
});
