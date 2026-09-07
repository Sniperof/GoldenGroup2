import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { columnsForGrantedScope, findTabularReport } from './tabularReportCatalog.js';
import { ReportingError } from './reportingError.js';

export type TabularReportSort = { sortKey: string; sortDir: 'asc' | 'desc' };

export function normalizeTabularReportSort(
  reportKey: string,
  access: TabularReportAccess,
  params: TabularReportRequestParams,
): TabularReportSort | null {
  const rawKey = typeof params.sortKey === 'string' ? params.sortKey.trim() : '';
  const rawDir = typeof params.sortDir === 'string' ? params.sortDir.toLowerCase() : '';
  if (!rawKey) {
    if (rawDir) throw new ReportingError(400, 'اتجاه الفرز يتطلب تحديد عمود قابل للفرز');
    return null;
  }
  const definition = findTabularReport(reportKey);
  const column = definition && columnsForGrantedScope(definition, access.grantedScope)
    .find(candidate => candidate.key === rawKey);
  if (!column?.sortable) throw new ReportingError(400, 'هذا العمود غير متاح للفرز في التقرير');
  if (rawDir && rawDir !== 'asc' && rawDir !== 'desc') throw new ReportingError(400, 'اتجاه فرز التقرير غير صالح');
  return { sortKey: column.key, sortDir: rawDir === 'desc' ? 'desc' : 'asc' };
}

export function buildTabularReportOrderBy(
  reportKey: string,
  access: TabularReportAccess,
  params: TabularReportRequestParams,
  stableFallback: string,
): string {
  const sort = normalizeTabularReportSort(reportKey, access, params);
  if (!sort) return stableFallback;
  // sortKey is selected exclusively from the server-owned report catalog.
  return `"${sort.sortKey}" ${sort.sortDir.toUpperCase()} NULLS LAST, ${stableFallback}`;
}
