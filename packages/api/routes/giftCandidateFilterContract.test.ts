import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./gifts.ts', import.meta.url), 'utf8');

function slice(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start > 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

test('gift record list filters a candidate through direct and source-sheet promises', () => {
  // `/records` and `/records/paged` share one WHERE builder.
  const builder = slice('function buildGiftRecordListWhere(', "router.get('/records'");
  assert.match(builder, /normalizePositiveInt\(req\.query\.candidateId\)/);
  assert.match(builder, /candidate_source\.candidate_id/);
  assert.match(builder, /candidate_source\.source_type = 'candidate'/);
  assert.match(builder, /candidate_context\.referral_sheet_id/);
  assert.match(builder, /list_source\.referral_sheet_id/);
  assert.match(builder, /list_source\.source_type = 'name_list'/);
  assert.match(builder, /accessPlan\.scope === 'BRANCH'/);
  assert.match(builder, /accessPlan\.scope === 'ASSIGNED'/);
  assert.match(builder, /candidate_assignment\.hr_user_id/);
  assert.match(builder, /sheet_subject\.assigned_hr_user_id/);
});

test('both gift record lists resolve the access plan and go through the shared builder', () => {
  const list = slice("router.get('/records', requirePermission('contract_gifts.view')", "router.get('/records/paged'");
  const paged = slice("router.get('/records/paged', requirePermission('contract_gifts.view')", "router.post('/records'");
  for (const route of [list, paged]) {
    assert.match(route, /getGiftListAccessPlan\(authContext, 'contract_gifts\.view'\)/);
    assert.match(route, /accessPlan\.scope === 'NONE'/);
    assert.match(route, /buildGiftRecordListWhere\(req, accessPlan/);
  }
});
