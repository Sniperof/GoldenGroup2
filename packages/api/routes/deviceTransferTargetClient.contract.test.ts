import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./openTasks.ts', import.meta.url), 'utf8');

test('device transfer to another customer validates the target like the picker does', () => {
  const block = source.slice(
    source.indexOf("if (transferKind === 'another_customer') {"),
    source.indexOf("AND task_type = 'device_transfer'"),
  );
  assert.ok(block.length > 0, 'another_customer validation block not found');
  // Existence alone is not enough: a suggested name cannot receive a device…
  assert.match(block, /is_candidate AS "isCandidate"/);
  assert.match(block, /if \(targetRows\[0\]\.isCandidate\)/);
  // …and the target must be inside the caller's client scope.
  assert.match(block, /loadClientSubject\(targetClientId\)/);
  assert.match(block, /canViewClient\(authContext, targetSubject\)\.allowed/);
  assert.match(block, /status\(403\)/);
});
