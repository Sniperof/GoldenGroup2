import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('background report worker claims durable jobs safely with bounded global concurrency', () => {
  const worker = readFileSync('packages/api/services/reporting/tabularReportWorker.ts', 'utf8');
  assert.match(worker, /MAX_CONCURRENT_REPORTS = 2/);
  assert.match(worker, /pg_try_advisory_lock/);
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
  assert.match(worker, /status='queued'/);
  assert.match(worker, /status='running'/);
  assert.match(worker, /status='completed'/);
  assert.match(worker, /status='failed'/);
  assert.match(worker, /buildAuthContext/);
  assert.match(worker, /report_run_runtime/);
});

test('live progress cannot update the report row during its repeatable-read snapshot', () => {
  const worker = readFileSync('packages/api/services/reporting/tabularReportWorker.ts', 'utf8');
  const migration = readFileSync('migrations/448_tabular_report_runtime_progress.sql', 'utf8');
  const service = readFileSync('packages/api/services/reporting/tabularReportService.ts', 'utf8');
  assert.match(worker, /UPDATE report_run_runtime[\s\S]*progress_rows=\$2/);
  assert.doesNotMatch(worker, /await pool\.query\(\s*`UPDATE report_runs SET progress_rows/);
  assert.match(worker, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ[\s\S]*UPDATE report_runs[\s\S]*status='completed'/);
  assert.match(migration, /report_run_id BIGINT PRIMARY KEY[\s\S]*ON DELETE CASCADE/);
  assert.match(service, /COALESCE\(runtime\.progress_rows,report_runs\.progress_rows\)/);
  assert.doesNotMatch(migration, /role_permission_grants|INSERT INTO public\.permissions/);
});

test('generation endpoint is asynchronous and the UI polls until completion', () => {
  const route = readFileSync('packages/api/routes/reports.ts', 'utf8');
  const service = readFileSync('packages/api/services/reporting/tabularReportService.ts', 'utf8');
  const page = readFileSync('packages/web/src/pages/Reports.tsx', 'utf8');
  assert.match(route, /router\.post\('\/tabular\/:reportKey\/generate'[\s\S]*res\.status\(202\)\.json\(data\)/);
  assert.match(service, /VALUES \(\$1,\$2,\$3,\$4::int\[\],\$5::jsonb,\$6::jsonb,0,'queued',NOW\(\)\)/);
  assert.match(page, /window\.setTimeout/);
  assert.match(page, /response\.status === 'completed'/);
  assert.match(page, /response\.status === 'failed'/);
});

test('streaming export uses a cursor, temporary file, and guaranteed cleanup', () => {
  const service = readFileSync('packages/api/services/reporting/tabularReportService.ts', 'utf8');
  const exporter = readFileSync('packages/api/services/reporting/tabularReportExcel.ts', 'utf8');
  const route = readFileSync('packages/api/routes/reports.ts', 'utf8');
  assert.match(service, /tabular_report_export_cursor/);
  assert.match(service, /FETCH FORWARD 1000/);
  assert.doesNotMatch(service, /buildTabularReportExcel\(definition, rows\.map/);
  assert.match(exporter, /WorkbookWriter/);
  assert.match(exporter, /maxDataRowsPerSheet = 1_048_572/);
  assert.match(route, /res\.download\(output\.filePath/);
  assert.match(route, /output\.cleanup\(\)/);
});

test('background lifecycle migration is forward-only and permission-neutral', () => {
  const migration = readFileSync('migrations/446_tabular_report_background_jobs.sql', 'utf8');
  assert.match(migration, /status TEXT NOT NULL DEFAULT 'completed'/);
  assert.match(migration, /CHECK \(status IN \('queued','running','completed','failed'\)\)/);
  assert.match(migration, /idx_report_runs_queue/);
  assert.doesNotMatch(migration, /role_permission_grants|INSERT INTO public\.permissions/);
});
