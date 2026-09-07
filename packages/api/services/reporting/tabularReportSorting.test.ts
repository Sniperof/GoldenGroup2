import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TabularReportAccess } from './tabularReportAccess.js';
import { buildTabularReportOrderBy, normalizeTabularReportSort } from './tabularReportSorting.js';
import { buildWorkFilesGeoSupervisorsQuery } from './workFilesGeoSupervisorsReport.js';
import { buildDailyVisitsQuery } from './dailyVisitsReport.js';
import { buildServiceDevicesQuery } from './serviceDevicesReport.js';
import { buildGeographicPortfolioQuery } from './geographicPortfolioReport.js';
import { buildSalesFollowUpTasksQuery } from './salesFollowUpTasksReport.js';
import { buildWorkFilesNamesFileQuery } from './workFilesNamesFileReport.js';
import { buildDailyWorkSalesFileQuery } from './dailyWorkSalesFileReport.js';
import { buildServiceDuesQuery } from './serviceDuesReport.js';

const globalAccess: TabularReportAccess = {
  scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1,
};

test('sorting accepts only catalog-owned sortable columns and directions', () => {
  assert.deepEqual(
    normalizeTabularReportSort('work_files.names_file', globalAccess, { sortKey: 'candidateName', sortDir: 'desc' }),
    { sortKey: 'candidateName', sortDir: 'desc' },
  );
  assert.deepEqual(
    normalizeTabularReportSort('work_files.names_file', globalAccess, { sortKey: 'candidateAddedDate' }),
    { sortKey: 'candidateAddedDate', sortDir: 'asc' },
  );
  assert.throws(
    () => normalizeTabularReportSort('work_files.names_file', globalAccess, { sortKey: 'candidateNotes' }),
    /غير متاح للفرز/,
  );
  assert.throws(
    () => normalizeTabularReportSort('work_files.names_file', globalAccess, { sortKey: 'candidateName"; DROP TABLE candidates;--' }),
    /غير متاح للفرز/,
  );
  assert.throws(
    () => normalizeTabularReportSort('work_files.names_file', globalAccess, { sortKey: 'candidateName', sortDir: 'sideways' }),
    /اتجاه فرز التقرير غير صالح/,
  );
});

test('sorting retains the report deterministic tie-breaker', () => {
  assert.equal(
    buildTabularReportOrderBy(
      'work_files.names_file', globalAccess,
      { sortKey: 'candidateName', sortDir: 'desc' },
      'candidate.created_at DESC, candidate.id DESC',
    ),
    '"candidateName" DESC NULLS LAST, candidate.created_at DESC, candidate.id DESC',
  );
});

test('all report queries use the shared server-side ordering contract', () => {
  for (const filename of [
    'workFilesGeoSupervisorsReport.ts', 'dailyVisitsReport.ts', 'serviceDevicesReport.ts',
    'geographicPortfolioReport.ts', 'salesFollowUpTasksReport.ts', 'workFilesNamesFileReport.ts',
    'dailyWorkSalesFileReport.ts', 'serviceDuesReport.ts',
  ]) {
    const source = readFileSync(`packages/api/services/reporting/${filename}`, 'utf8');
    assert.match(source, /buildTabularReportOrderBy/);
  }
  const route = readFileSync('packages/api/routes/reports.ts', 'utf8');
  const page = readFileSync('packages/web/src/pages/Reports.tsx', 'utf8');
  assert.match(route, /sortKey: input\.sortKey, sortDir: input\.sortDir/);
  assert.match(page, /تغيّر ترتيب التقرير/);
  assert.match(page, /sortKey: sortKey \?\? undefined/);
  assert.match(page, /disabled=\{!data \|\| exporting \|\| snapshotDirty\}/);
});

test('every report builder applies its selected sort before limit and snapshotting', () => {
  const cases = [
    buildWorkFilesGeoSupervisorsQuery(globalAccess, { sortKey: 'leadCount', sortDir: 'desc' }, { limit: 10 }).sql,
    buildDailyVisitsQuery(globalAccess, { fromDate: '2026-01-01', toDate: '2026-01-31', sortKey: 'clientName' }, { limit: 10 }).sql,
    buildServiceDevicesQuery(globalAccess, { sortKey: 'paidAmount', sortDir: 'desc' }, { limit: 10 }).sql,
    buildGeographicPortfolioQuery(globalAccess, { sortKey: 'totalCustomers', sortDir: 'desc' }, { limit: 10 }).sql,
    buildSalesFollowUpTasksQuery(globalAccess, { fromDate: '2026-01-01', toDate: '2026-01-31', sortKey: 'taskType' }, { limit: 10 }).sql,
    buildWorkFilesNamesFileQuery(globalAccess, { sortKey: 'candidateName' }, { limit: 10 }).sql,
    buildDailyWorkSalesFileQuery(globalAccess, { fromDate: '2026-01-01', toDate: '2026-01-31', sortKey: 'sellerName' }, { limit: 10 }).sql,
    buildServiceDuesQuery(globalAccess, { fromDate: '2026-01-01', toDate: '2026-01-31', financialAsOfDate: '2026-01-31', sortKey: 'dueDate' }, { limit: 10 }).sql,
  ];
  for (const sql of cases) {
    assert.match(sql, /ORDER BY "[A-Za-z]+" (?:ASC|DESC) NULLS LAST,[\s\S]*LIMIT/);
  }
});
