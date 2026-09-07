import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMediatorGiftsQuery } from './mediatorGiftsReport.js';
import { normalizedFilters } from './tabularReportService.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 1 };

test('mediator gifts uses converted candidate as its grain and keeps gifts optional', () => {
  const { sql } = buildMediatorGiftsQuery(GLOBAL_ACCESS, {}, { limit: 25 });

  assert.match(sql, /candidate\.qualification_kind='converted'/);
  assert.match(sql, /converted_client\.candidate_status='OP'/);
  assert.match(sql, /LEFT JOIN LATERAL \([\s\S]*WITH matched_gifts AS/);
  assert.match(sql, /COALESCE\(gift\.gift_summary,'لم يُنشأ سجل هدية'\)/);
  assert.match(sql, /ORDER BY contract\.closing_date ASC NULLS LAST[\s\S]*LIMIT 1/);
  assert.match(sql, /COUNT\(\*\) OVER\(\)::int AS "totalRows"/);
});

test('mediator gifts enforces branch and assigned candidate scope', () => {
  const { sql, params } = buildMediatorGiftsQuery(
    { scope: 'ASSIGNED', grantedScope: 'ASSIGNED', branchIds: [1002], userId: 77 },
    {},
    { limit: 10 },
  );

  assert.match(sql, /candidate\.branch_id = ANY\(\$1::int\[\]\)/);
  assert.match(sql, /candidate_assignments scoped_assignment/);
  assert.match(sql, /scoped_assignment\.hr_user_id=\$2/);
  assert.deepEqual(params.slice(0, 2), [[1002], 77]);
});

test('mediator gift filters are exact and validated', () => {
  const { sql, params } = buildMediatorGiftsQuery(GLOBAL_ACCESS, {
    candidateSourceType: 'name_list', mediatorType: 'Client', giftPromiseStatus: 'none',
    giftConditionStatus: 'pending', giftDeliveryResult: 'rescheduled', giftDefinitionId: 3,
    opFrom: '2026-01-01', opTo: '2026-12-31',
  }, { limit: 10 });

  assert.match(sql, /candidate\.referral_sheet_id IS NOT NULL/);
  assert.match(sql, /gift\.record_count=0/);
  assert.match(sql, /=ANY\(gift\.condition_keys\)/);
  assert.match(sql, /=ANY\(gift\.delivery_result_keys\)/);
  assert.match(sql, /=ANY\(gift\.definition_ids\)/);
  assert.ok(params.includes('Client'));
  assert.throws(
    () => buildMediatorGiftsQuery(GLOBAL_ACCESS, { giftDeliveryResult: 'unknown' }, { limit: 10 }),
    /نتيجة تسليم الهدية غير صالح/,
  );
  assert.throws(
    () => buildMediatorGiftsQuery(GLOBAL_ACCESS, { opFrom: '2026-02-02', opTo: '2026-01-01' }, { limit: 10 }),
    /بداية تاريخ التحول إلى OP يجب ألا تكون بعد نهايته/,
  );
});

test('shared name-list permission is reused instead of introducing a permission key', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('./tabularReportCatalog.ts', import.meta.url), 'utf8',
  ));
  const definition = String(source).match(/const workFilesMediatorGifts:[\s\S]*?\n};/)?.[0] ?? '';
  assert.match(definition, /viewPermission: 'reports\.work_files\.names_file\.view'/);
  assert.match(definition, /exportPermission: 'reports\.work_files\.names_file\.export'/);
});

test('worker snapshot keeps mediator gift filters after request normalization', () => {
  const filters = normalizedFilters({
    opFrom: '2026-01-01', contractTo: '2026-12-31', giftDeliveryFrom: '2026-02-01',
    giftConditionStatus: 'met', giftDeliveryResult: 'delivered_successfully', giftDefinitionId: '3',
  });
  assert.equal(filters.opFrom, '2026-01-01');
  assert.equal(filters.contractTo, '2026-12-31');
  assert.equal(filters.giftDeliveryFrom, '2026-02-01');
  assert.equal(filters.giftConditionStatus, 'met');
  assert.equal(filters.giftDeliveryResult, 'delivered_successfully');
  assert.equal(filters.giftDefinitionId, 3);
});
