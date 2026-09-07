import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cleanupExpiredTabularReportRuns } from './tabularReportCleanupJob.js';

test('expired snapshot cleanup is bounded and excludes active or pinned runs', async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const deleted = await cleanupExpiredTabularReportRuns(500, {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rowCount: 4 } as never;
    },
  } as never);
  assert.equal(deleted, 4);
  assert.deepEqual(calls[0].params, [100]);
  assert.match(calls[0].sql, /expires_at <= NOW\(\)/);
  assert.match(calls[0].sql, /is_pinned IS FALSE/);
  assert.match(calls[0].sql, /status IN \('completed','failed'\)/);
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
});

test('P2 migration adds measured indexes, expiry, and preserves export audit', () => {
  const migration = readFileSync('migrations/447_tabular_reports_p2_indexes_and_retention.sql', 'utf8');
  assert.match(migration, /idx_candidates_branch_created_id/);
  assert.match(migration, /idx_gift_record_sources_candidate_record/);
  assert.match(migration, /idx_gift_record_sources_sheet_record/);
  assert.match(migration, /expires_at[\s\S]*INTERVAL '30 days'/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.doesNotMatch(migration, /role_permission_grants|INSERT INTO public\.permissions/);
});
