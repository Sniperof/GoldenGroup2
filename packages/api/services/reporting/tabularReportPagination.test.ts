import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_TABULAR_REPORT_PAGE_SIZE,
  persistTabularReportSnapshot,
  resolveTabularReportPagination,
  TABULAR_SNAPSHOT_BATCH_SIZE,
} from './tabularReportService.js';

test('tabular reports default to ten rows per page', () => {
  assert.equal(DEFAULT_TABULAR_REPORT_PAGE_SIZE, 10);
  assert.deepEqual(resolveTabularReportPagination({}), { page: 1, limit: 10, offset: 0, startRow: 1, endRow: 10 });
});

test('page and limit produce a server-side offset and invalid values fall back safely', () => {
  assert.deepEqual(resolveTabularReportPagination({ page: 3, limit: 10 }), { page: 3, limit: 10, offset: 20, startRow: 21, endRow: 30 });
  assert.deepEqual(resolveTabularReportPagination({ page: 0, limit: -1 }), { page: 1, limit: 10, offset: 0, startRow: 1, endRow: 10 });
  assert.deepEqual(resolveTabularReportPagination({ page: 2, limit: 500 }), { page: 2, limit: 200, offset: 200, startRow: 201, endRow: 400 });
});

test('generate and page endpoints both carry the explicit ten-row contract', () => {
  const route = readFileSync('packages/api/routes/reports.ts', 'utf8');
  const page = readFileSync('packages/web/src/pages/Reports.tsx', 'utf8');
  assert.match(route, /page: input\.page, limit: input\.limit/);
  assert.match(page, /const REPORT_PAGE_SIZE = 10/);
  assert.match(page, /page: 1,[\s\S]*limit: REPORT_PAGE_SIZE/);
  assert.match(page, /tabularRun\(data\.runId, \{ page, limit: REPORT_PAGE_SIZE \}\)/);
  assert.doesNotMatch(page, /limit: 50/);
});

test('snapshot rows are fetched and inserted in bounded batches with continuous row numbers', async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const fetchBatches = [[{ id: 1 }, { id: 2 }], [{ id: 3 }]];
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.startsWith('FETCH FORWARD')) return { rows: fetchBatches.shift() ?? [] };
      return { rows: [] };
    },
  };

  const result = await persistTabularReportSnapshot(
    client as never,
    '77',
    { sql: 'SELECT value FROM source WHERE branch_id=$1 ORDER BY value LIMIT $2', params: [3, 2_147_483_647] },
    2,
  );

  assert.equal(result.rowCount, 3);
  assert.equal(result.metrics.batchSize, 2);
  assert.equal(result.metrics.batchCount, 2);
  assert.ok(result.metrics.totalSnapshotMs >= 0);
  assert.match(calls[0].sql, /^DECLARE tabular_report_snapshot_cursor NO SCROLL CURSOR FOR SELECT/);
  assert.deepEqual(calls[0].params, [3, 2_147_483_647]);
  assert.deepEqual(calls.filter(call => call.sql.startsWith('FETCH')).map(call => call.sql), [
    'FETCH FORWARD 2 FROM tabular_report_snapshot_cursor',
    'FETCH FORWARD 2 FROM tabular_report_snapshot_cursor',
  ]);
  const inserts = calls.filter(call => call.sql.startsWith('INSERT INTO report_run_rows'));
  assert.deepEqual(inserts.map(call => call.params?.slice(0, 2)), [['77', 0], ['77', 2]]);
  assert.equal(calls.at(-1)?.sql, 'CLOSE tabular_report_snapshot_cursor');
});

test('snapshot infrastructure has a bounded default batch and rejects unsafe batch sizes', async () => {
  assert.equal(TABULAR_SNAPSHOT_BATCH_SIZE, 1_000);
  await assert.rejects(
    persistTabularReportSnapshot({ query: async () => ({ rows: [] }) } as never, '1', { sql: 'SELECT 1', params: [] }, 0),
    /حجم دفعة التقرير غير صالح/,
  );
  const service = readFileSync('packages/api/services/reporting/tabularReportService.ts', 'utf8');
  const worker = readFileSync('packages/api/services/reporting/tabularReportWorker.ts', 'utf8');
  assert.match(worker, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(service, /row_number BETWEEN \$2 AND \$3/);
  assert.doesNotMatch(service, /ORDER BY row_number LIMIT \$2 OFFSET \$3/);
  assert.match(worker, /generation_metrics=\$4::jsonb/);
  assert.match(service, /report_export_audit[\s\S]*metrics/);
  assert.doesNotMatch(service, /MAX_REPORT_ROWS|يتجاوز الحد/);
});

test('snapshot queries skip repeated total-row windows while direct paged queries retain them', () => {
  const worker = readFileSync('packages/api/services/reporting/tabularReportWorker.ts', 'utf8');
  assert.match(worker, /includeTotalRows: false/);
  for (const filename of [
    'workFilesGeoSupervisorsReport.ts',
    'dailyVisitsReport.ts',
    'serviceDevicesReport.ts',
    'geographicPortfolioReport.ts',
    'salesFollowUpTasksReport.ts',
  ]) {
    const source = readFileSync(`packages/api/services/reporting/${filename}`, 'utf8');
    assert.match(source, /includeTotalRows\?: boolean/);
    assert.match(source, /includeTotalRows === false/);
  }
});

test('performance metrics migration is forward-only and does not touch permissions', () => {
  const migration = readFileSync('migrations/445_tabular_report_performance_metrics.sql', 'utf8');
  assert.match(migration, /report_runs[\s\S]*generation_metrics JSONB/);
  assert.match(migration, /report_export_audit[\s\S]*metrics JSONB/);
  assert.doesNotMatch(migration, /permissions|role_permission_grants/);
});
