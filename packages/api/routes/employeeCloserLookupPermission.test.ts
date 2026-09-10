import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./employees.ts', import.meta.url), 'utf8');

test('closer lookup accepts the operational employee lookup permission', () => {
  assert.match(
    source,
    /router\.get\('\/closers',\s*requirePermission\('employees\.lookup',\s*'employees\.view_list'\)/,
  );
});
