import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./clientProfile/NetworkTab.tsx', import.meta.url), 'utf8');

test('network failures are visible and can be retried instead of rendering an empty network', () => {
  const networkTab = source.slice(source.indexOf('export default function NetworkTab'));
  assert.match(networkTab, /setError\(err\?\.message/);
  assert.match(networkTab, /if \(error\)/);
  assert.match(networkTab, /إعادة المحاولة/);
  assert.match(networkTab, /setReloadKey\(value => value \+ 1\)/);
});
