import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('assigned client pagination materializes authorized ids before row enrichment', () => {
  const route = readFileSync(new URL('./clients.ts', import.meta.url), 'utf8');

  assert.match(route, /scope !== 'ASSIGNED'/);
  assert.match(route, /WITH scoped_client_ids AS MATERIALIZED/);
  assert.match(route, /'  FROM scoped_client_ids scoped\\n  JOIN clients c ON c\.id = scoped\.id'/);
  assert.match(route, /const pageQuery = buildPagedClientRowsQuery/);
  assert.match(route, /pool\.query\(pageQuery, pageParams\)/);
});
