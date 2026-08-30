import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./candidates.ts', import.meta.url), 'utf8');

const listStart = source.indexOf("router.get('/', requirePermission('candidates.view_list')");
const pagedStart = source.indexOf("router.get('/paged', requirePermission('candidates.view_list')");
const detailStart = source.indexOf("router.get('/:id', requirePermission('candidates.view_list')");

test('the paged route is registered before /:id so Express cannot swallow it as an id', () => {
  assert.ok(pagedStart > 0, 'GET /paged must exist');
  assert.ok(detailStart > 0, 'GET /:id must exist');
  assert.ok(pagedStart < detailStart, 'GET /paged must be registered before GET /:id');
});

test('list and paged share one scope helper — the scope SQL is written once', () => {
  const list = source.slice(listStart, pagedStart);
  const paged = source.slice(pagedStart, detailStart);

  assert.match(list, /appendCandidateScopeConditions\(authContext, requestedBranchId, listAccess\.scope, params\)/);
  assert.match(paged, /appendCandidateScopeConditions\(authContext, requestedBranchId, listAccess\.scope, params\)/);

  // Neither route may re-implement the scope predicates inline.
  assert.doesNotMatch(list, /conditions\.push\(`c\.branch_id = ANY/);
  assert.doesNotMatch(paged, /conditions\.push\(`c\.branch_id = ANY\(\$\$\{params\.length\}::int\[\]\)`\)/);
});

test('the scope helper keeps all three visibility branches', () => {
  const helperStart = source.indexOf('function appendCandidateScopeConditions');
  const helperEnd = source.indexOf('\n}', helperStart);
  assert.ok(helperStart > 0);
  const helper = source.slice(helperStart, helperEnd);

  // Explicit branch filter (X-Branch-Id) narrows to that branch.
  assert.match(helper, /if \(requestedBranchId != null\)[\s\S]*?c\.branch_id = \$\$\{params\.length\}/);
  // BRANCH scope is limited to the caller's allowed branches.
  assert.match(helper, /if \(scope === 'BRANCH'\)[\s\S]*?c\.branch_id = ANY\(\$\$\{params\.length\}::int\[\]\)/);
  // ASSIGNED scope additionally requires an assignment row for the caller.
  assert.match(
    helper,
    /if \(scope === 'ASSIGNED'\)[\s\S]*?EXISTS \(SELECT 1 FROM candidate_assignments WHERE candidate_id = c\.id AND hr_user_id = \$\$\{params\.length\}\)/,
  );
  assert.match(helper, /if \(scope === 'ASSIGNED'\)[\s\S]*?c\.branch_id = ANY\(\$\$\{params\.length\}::int\[\]\)/);
});

test('paged enforces the same three access guards as the unpaged list', () => {
  const paged = source.slice(pagedStart, detailStart);

  assert.match(paged, /allowedBranchIds\.length === 0[\s\S]*?res\.status\(403\)/);
  assert.match(paged, /forbidCandidateAccess\(res, 'BRANCH_FORBIDDEN'\)/);
  assert.match(paged, /listAccess\.scope === 'NONE'[\s\S]*?forbidCandidateAccess\(res, 'MISSING_PERMISSION'\)/);
});

test('paged bounds the page size and only sorts by whitelisted keys', () => {
  const paged = source.slice(pagedStart, detailStart);

  // Page size is capped at 100; only an explicit id batch may go higher, and it
  // is bounded by the ids themselves (and by the 500-id slice on the ids array).
  assert.match(paged, /const maxLimit = idsRaw \? 500 : 100;/);
  assert.match(paged, /Math\.min\(maxLimit, Math\.max\(1, toPositiveInt\(req\.query\.limit\) \?\? 25\)\)/);
  assert.match(paged, /ids\.slice\(0, 500\)/);
  assert.match(paged, /CANDIDATE_SORT_COLUMNS\[req\.query\.sortKey\]/);
  assert.match(paged, /: 'createdAt';/, 'default sort must stay createdAt — page 1 mirrors the old first screen');
  assert.match(paged, /req\.query\.sortDir === 'asc' \? 'ASC' : 'DESC'/);
});

test('paged returns the page, the derived total and the status KPIs in one round trip', () => {
  const paged = source.slice(pagedStart, detailStart);

  assert.match(paged, /await Promise\.all\(\[/);
  assert.match(paged, /GROUP BY 1/);
  assert.match(paged, /res\.json\(\{ items: pageResult\.rows, total, page, limit, kpis \}\)/);
});

test('GET / keeps its unpaged contract for existing consumers', () => {
  const list = source.slice(listStart, pagedStart);

  assert.match(list, /res\.json\(rows\)/, 'the legacy list must still return a bare array');
  assert.doesNotMatch(list, /LIMIT/, 'adding a LIMIT here would silently truncate existing consumers');
});
