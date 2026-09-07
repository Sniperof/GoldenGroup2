import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReferralGiftPromise,
  ReferralGiftPromiseError,
  updateReferralGiftPromise,
} from './referralGiftPromises.js';

test('direct candidate promise derives its beneficiary and ownership from the persisted source', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM candidates c')) {
        return { rows: [{
          id: 41,
          referral_sheet_id: null,
          referral_type: 'Client',
          referral_entity_id: 23,
          referral_name_snapshot: 'الوسيط المثبت',
          branch_id: 2,
          assigned_user_id: 15,
        }] };
      }
      if (sql.includes('SELECT id FROM clients')) return { rows: [{ id: 23 }] };
      if (sql.includes('FROM gift_definitions')) return { rows: [{ id: 4 }] };
      if (sql.includes('FROM system_lists')) return { rows: [{ id: 7, value: 'candidate_referral_sale' }] };
      if (sql.includes('FROM gift_records')) return { rows: [] };
      if (sql.includes('INSERT INTO gift_records')) return { rows: [{ id: 101 }] };
      return { rows: [], rowCount: 1 };
    },
  };

  const id = await createReferralGiftPromise(db as any, {
    sourceType: 'candidate',
    sourceId: 41,
    draft: { giftDefinitionId: 4, conditionLabel: 'عند تحول الاسم إلى زبون', quantity: 2 },
    actorUserId: 9,
  });

  assert.equal(id, 101);
  const recordInsert = calls.find(call => call.sql.includes('INSERT INTO gift_records'))!;
  assert.match(recordInsert.sql, /'pending'/);
  assert.match(recordInsert.sql, /approved_quantity[\s\S]*NULL/);
  assert.deepEqual(recordInsert.params, [
    4, 'customer_referrer', 23, null, 'الوسيط المثبت', 23, 7,
    'عند تحول الاسم إلى زبون', 2, 2, 15, 9,
  ]);
  const sourceInsert = calls.find(call => call.sql.includes('INSERT INTO gift_record_sources'))!;
  assert.deepEqual(sourceInsert.params.slice(0, 4), [101, 'candidate', null, 41]);
});

test('a candidate belonging to a list cannot create a separate direct promise', async () => {
  const db = {
    async query(sql: string) {
      if (sql.includes('FROM candidates c')) {
        return { rows: [{ id: 41, referral_sheet_id: 8 }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    createReferralGiftPromise(db as any, {
      sourceType: 'candidate',
      sourceId: 41,
      draft: { giftDefinitionId: 4, quantity: 1 },
      actorUserId: 9,
    }),
    (error: unknown) => error instanceof ReferralGiftPromiseError
      && error.code === 'candidate_gift_source_is_name_list',
  );
});

test('referral promise editing refuses records materialized from a contract', async () => {
  const db = {
    async query(sql: string) {
      if (sql.includes('FROM gift_definitions')) return { rows: [{ id: 4 }] };
      if (sql.includes('FROM gift_records gr')) {
        return { rows: [{
          id: 101,
          status: 'promised',
          gift_definition_id: 4,
          condition_label: 'شرط العقد',
          promised_quantity: 1,
          has_contract_source: true,
        }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    updateReferralGiftPromise(db as any, {
      giftRecordId: 101,
      giftDefinitionId: 4,
      conditionLabel: 'محاولة تعديل',
      quantity: 2,
      actorUserId: 9,
    }),
    (error: unknown) => error instanceof ReferralGiftPromiseError
      && error.code === 'referral_gift_promise_locked',
  );
});
