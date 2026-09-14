import assert from 'node:assert/strict';
import test from 'node:test';
import { TABULAR_REPORTS, findTabularReport } from './tabularReportCatalog.js';
import { buildReportQuery } from './tabularReportService.js';

const ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 1 };
const WINDOW = { fromDate: '2026-08-01', toDate: '2026-08-31' };

/** Params a report refuses to run without, unrelated to its window. */
const REQUIRED_EXTRAS: Record<string, Record<string, string>> = {
  'performance.sales_count': { deviceModelIds: '11,12' },
  'service.dues': { financialAsOfDate: '2026-08-31' },
};

const periodReports = TABULAR_REPORTS.filter(report => report.filters.dateRange === 'required');

function sqlFor(reportKey: string): string {
  const extras = REQUIRED_EXTRAS[reportKey] ?? {};
  return buildReportQuery(reportKey, ACCESS, { ...WINDOW, ...extras }, { limit: 10 }).sql;
}

test('every period report actually binds both ends of its window', () => {
  assert.ok(periodReports.length >= 11, 'the period reports are still being covered');
  for (const report of periodReports) {
    const { sql, params } = buildReportQuery(
      report.key, ACCESS, { ...WINDOW, ...(REQUIRED_EXTRAS[report.key] ?? {}) }, { limit: 10 },
    );
    const fromIndex = params.indexOf(WINDOW.fromDate);
    const toIndex = params.indexOf(WINDOW.toDate);
    assert.ok(fromIndex >= 0, `${report.key} never binds the window start`);
    assert.ok(toIndex >= 0, `${report.key} never binds the window end`);
    assert.match(sql, new RegExp(`\\$${fromIndex + 1}\\b`), `${report.key} binds the start but never uses it`);
    assert.match(sql, new RegExp(`\\$${toIndex + 1}\\b`), `${report.key} binds the end but never uses it`);
  }
});

test('a period report refuses to run without its window rather than ignoring it', () => {
  // Checked by status, not by wording: each report words its own message, and a
  // silent fallback to «all time» is the failure this guards against.
  const rejects = (params: Record<string, string>, reportKey: string, what: string) => {
    let status: unknown = null;
    try { buildReportQuery(reportKey, ACCESS, params, { limit: 10 }); } catch (error) {
      status = (error as { status?: number }).status;
    }
    assert.equal(status, 400, `${reportKey} must reject ${what} with 400`);
  };

  for (const report of periodReports) {
    const extras = REQUIRED_EXTRAS[report.key] ?? {};
    rejects({ ...extras }, report.key, 'a missing window');
    rejects({ fromDate: WINDOW.toDate, toDate: WINDOW.fromDate, ...extras }, report.key, 'a reversed window');
    rejects({ fromDate: '31-08-2026', toDate: WINDOW.toDate, ...extras }, report.key, 'a malformed date');
  }
});

test('no window boundary is left to the database session timezone', () => {
  // A timestamp column compared against a bare `$n::date` resolves the midnight in
  // whatever timezone the session carries: correct while the server runs on Damascus
  // and three hours wrong the day it runs on UTC, with no error either way. Every
  // boundary states its zone instead.
  // Only timestamp columns are at risk. `due_date`, `scheduled_date` and
  // `installation_date` are real dates, and `contract_date` is text — none of them
  // carries a time of day to misplace. `call_date` is the trap: it IS a timestamptz.
  const TIMESTAMP_COLUMNS = 'closed_at|created_at|received_at|occurred_at|call_date|cancelled_at|activated_at';
  const unpinned = new RegExp(`(?:${TIMESTAMP_COLUMNS})\\s*(?:>=|<=|<|>)\\s*\\$\\d+::date(?!::)`);
  for (const report of periodReports) {
    const sql = sqlFor(report.key);
    const offender = sql.match(unpinned);
    assert.equal(offender, null, `${report.key} compares a timestamp to an unpinned date: ${offender?.[0]}`);
  }
});

test('every Damascus boundary closes the last day rather than cutting it at midnight', () => {
  // The upper bound is exclusive on the NEXT day, so a task closed at 22:00 on the
  // last day still counts. An inclusive `<= toDate` on a timestamp would drop it.
  for (const report of periodReports) {
    const sql = sqlFor(report.key);
    const inclusiveTimestampEnd = /(?:closed_at|created_at|call_date|received_at|occurred_at)\s*<=\s*\$\d+/;
    assert.equal(
      sql.match(inclusiveTimestampEnd), null,
      `${report.key} ends its window inclusively on a timestamp, losing that day's evening`,
    );
  }
});

test('the one column that ignores the window says so in its own title', () => {
  // Seller headcount cannot be period-bounded: employees carry a hire date but no
  // termination date, so «who was employed during the window» is unknowable. It stays
  // a current-state column, and its title has to admit that.
  const definition = findTabularReport('performance.department_results');
  assert.ok(definition);
  const column = definition.columns.find(item => item.key === 'dealerCount');
  assert.ok(column, 'the seller headcount column still exists');
  assert.match(column.titleAr, /حالي/, 'a column that ignores the window must say so in its title');
  assert.match(
    definition.guide.columnDescriptions.dealerCount ?? '',
    /لا يتبع مدة التقرير/,
    'and its guide must state it plainly',
  );
});
