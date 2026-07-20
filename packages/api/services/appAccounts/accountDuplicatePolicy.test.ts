import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { detectAccountRequestDuplicate } from './accountDuplicatePolicy.js';

// Routes queries by SQL shape. Candidate rows carry pre-computed name_sim /
// phone_match (the pg_trgm similarity is DB-side and exercised live), so these
// tests pin the JS scoring + flag/audit routing.
function mockDb(
  candidates: { kind: 'account' | 'request'; ref_id: number; name_sim: number; phone_match: number }[],
  opts: { threshold?: string; seedName?: string; seedPhone?: string } = {},
) {
  const calls = { update: [] as any[][], audits: [] as string[] };
  const db = {
    async query(sql: string, params?: any[]) {
      if (sql.includes('system_settings')) return { rows: [{ value: opts.threshold ?? '0.75' }] };
      if (sql.includes('UNION ALL')) return { rows: candidates };
      if (sql.includes('requester_external') && sql.includes('WHERE id = $1')) {
        return { rows: [{ name: opts.seedName ?? 'أحمد علي', phone: opts.seedPhone ?? '0955000000' }] };
      }
      if (sql.includes('SET') && sql.includes('duplicate_flag')) {
        calls.update.push(params ?? []);
        return { rows: [] };
      }
      calls.audits.push(sql); // appendAudit inserts
      return { rows: [{ id: 1 }] };
    },
  };
  return { db: db as unknown as PoolClient, calls };
}

test('flags the highest-scoring candidate above threshold (account match)', async () => {
  const { db, calls } = mockDb([
    { kind: 'account', ref_id: 7, name_sim: 1.0, phone_match: 0.8 }, // score 0.9
    { kind: 'request', ref_id: 9, name_sim: 0.3, phone_match: 0.0 }, // score 0.15
  ]);
  const out = await detectAccountRequestDuplicate(db, 100, null, 'customer');
  assert.equal(out.flagged, true);
  assert.equal(out.bestMatch?.kind, 'account');
  assert.equal(out.bestMatch?.refId, 7);
  assert.equal(calls.update.length, 1);
  assert.deepEqual(calls.update[0], [100, null]); // account → no duplicate_of_request_id
  assert.equal(calls.audits.length, 2); // duplicate_flag_set + review_required_flag_set
});

test('a request match populates duplicate_of_request_id', async () => {
  const { db, calls } = mockDb([
    { kind: 'request', ref_id: 42, name_sim: 1.0, phone_match: 0.5 }, // score 0.75
  ]);
  const out = await detectAccountRequestDuplicate(db, 100, null, 'customer');
  assert.equal(out.flagged, true);
  assert.deepEqual(calls.update[0], [100, 42]);
});

test('does not flag when best score is below threshold', async () => {
  const { db, calls } = mockDb([
    { kind: 'account', ref_id: 7, name_sim: 0.5, phone_match: 0.5 }, // score 0.5
  ]);
  const out = await detectAccountRequestDuplicate(db, 100, null, 'customer');
  assert.equal(out.flagged, false);
  assert.equal(calls.update.length, 0);
  assert.equal(calls.audits.length, 0);
});

test('no candidates → not flagged', async () => {
  const { db, calls } = mockDb([]);
  const out = await detectAccountRequestDuplicate(db, 100, null, 'customer');
  assert.equal(out.flagged, false);
  assert.equal(out.consideredCount, 0);
  assert.equal(calls.update.length, 0);
});

test('empty seed name+phone skips detection', async () => {
  const { db, calls } = mockDb(
    [{ kind: 'account', ref_id: 7, name_sim: 1.0, phone_match: 1.0 }],
    { seedName: '', seedPhone: '' },
  );
  const out = await detectAccountRequestDuplicate(db, 100, null, 'customer');
  assert.equal(out.flagged, false);
  assert.equal(calls.update.length, 0);
});

test('threshold is read from system_settings (tunable)', async () => {
  // score 0.75 would flag at default 0.75, but the tuned threshold is 0.9.
  const { db } = mockDb(
    [{ kind: 'request', ref_id: 42, name_sim: 1.0, phone_match: 0.5 }],
    { threshold: '0.9' },
  );
  const out = await detectAccountRequestDuplicate(db, 100, null, 'customer');
  assert.equal(out.flagged, false);
});
