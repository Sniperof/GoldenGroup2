import { findMetric } from './metricsCatalog.js';
import { findBreakdown } from './breakdownCatalog.js';

export interface DashboardLayoutItem {
  key: string;
  size: 'sm' | 'md' | 'lg';
  scope: { branchId?: number } | null;
}

export class DashboardLayoutValidationError extends Error {
  constructor(public readonly status: 400 | 403, message: string) {
    super(message);
    this.name = 'DashboardLayoutValidationError';
  }
}

type AuthorizeWidget = (permission: string, branchId: number | null) => void;

export function normalizeDashboardLayout(input: unknown, authorizeWidget: AuthorizeWidget, strict = true): DashboardLayoutItem[] {
  if (!Array.isArray(input)) {
    if (strict) throw new DashboardLayoutValidationError(400, 'تنسيق تخطيط الداشبورد غير صالح');
    return [];
  }

  const result: DashboardLayoutItem[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    try {
      if (!raw || typeof raw !== 'object') throw new DashboardLayoutValidationError(400, 'عنصر تخطيط غير صالح');
      const key = (raw as { key?: unknown }).key;
      if (typeof key !== 'string' || key.length === 0 || key.length > 80) {
        throw new DashboardLayoutValidationError(400, 'مفتاح مؤشر غير صالح');
      }
      if (seen.has(key)) continue;
      const definition = findMetric(key) ?? findBreakdown(key);
      if (!definition) throw new DashboardLayoutValidationError(400, `المؤشر غير معروف: ${key}`);

      const requestedSize = (raw as { size?: unknown }).size;
      const size = requestedSize === 'sm' || requestedSize === 'md' || requestedSize === 'lg'
        ? requestedSize
        : (findMetric(key) ? 'sm' : 'lg');
      const rawScope = (raw as { scope?: unknown }).scope;
      let branchId: number | null = null;
      if (rawScope && typeof rawScope === 'object') {
        const parsed = Number((rawScope as { branchId?: unknown }).branchId);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new DashboardLayoutValidationError(400, 'نطاق الفرع المثبت غير صالح');
        }
        branchId = parsed;
      }

      authorizeWidget(definition.permission, branchId);
      seen.add(key);
      result.push({ key, size, scope: branchId == null ? null : { branchId } });
      if (result.length >= 60) break;
    } catch (error) {
      if (strict) throw error;
    }
  }
  return result;
}
