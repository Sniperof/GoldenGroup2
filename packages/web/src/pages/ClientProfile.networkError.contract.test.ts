import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ClientProfile.tsx', import.meta.url), 'utf8');

test('network failures are visible and can be retried instead of rendering an empty network', () => {
  const networkTab = source.slice(source.indexOf('function NetworkTab'));
  assert.match(networkTab, /setError\(\(e as any\)\?\.message/);
  assert.match(networkTab, /if \(error\)/);
  assert.match(networkTab, /إعادة المحاولة/);
  assert.match(networkTab, /setReloadKey\(value => value \+ 1\)/);
});
