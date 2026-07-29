import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./gifts.ts', import.meta.url), 'utf8');

test('gift record list filters a candidate through direct and source-sheet promises', () => {
  const routeStart = source.indexOf("router.get('/records', requirePermission('contract_gifts.view')");
  const routeEnd = source.indexOf("router.post('/records'", routeStart);
  assert.ok(routeStart > 0);
  assert.ok(routeEnd > routeStart);

  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /normalizePositiveInt\(req\.query\.candidateId\)/);
  assert.match(route, /candidate_source\.candidate_id/);
  assert.match(route, /candidate_source\.source_type = 'candidate'/);
  assert.match(route, /candidate_context\.referral_sheet_id/);
  assert.match(route, /list_source\.referral_sheet_id/);
  assert.match(route, /list_source\.source_type = 'name_list'/);
  assert.match(route, /getGiftListAccessPlan/);
  assert.match(route, /accessPlan\.scope === 'BRANCH'/);
  assert.match(route, /accessPlan\.scope === 'ASSIGNED'/);
});
