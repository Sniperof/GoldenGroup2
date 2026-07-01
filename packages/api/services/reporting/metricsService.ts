// ============================================================
// metricsService.ts — تنفيذ مؤشر مع التقييد بالنطاق والكاش
// (reporting-analytics §1.1 عقد النطاق · §7 معيار الجلب/التحديث · §8.1 الصلاحيات)
// ============================================================
// المسار:
//   1) إيجاد تعريف المؤشر في الكتالوج.
//   2) plan = resolveListAccessScope(authContext, def.permission) — بوابة الرؤية + الاتساع.
//   3) حصر الاتساع المطلوب ضمن منح المستخدم (لا اختراع نطاق §8.1).
//   4) نافذة زمنية + بصمة نطاق (scope_signature).
//   5) كاش: يُخدم إن كان حديثًا (< فترة الأدمن) ولم يُطلب تحديث؛ وإلا يُعاد الحساب ويُكتب.
// ============================================================

import type { AuthContext } from '@golden-crm/shared';
import pool from '../../db.js';
import { resolveListAccessScope } from '../authorizationService.js';
import { getSystemSettingNumber } from '../systemSettings.js';
import { findMetric, type MetricComputeContext, type ScopeMode } from './metricsCatalog.js';
import { resolveTimeWindow } from './timeWindow.js';

export class ReportingError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface GetMetricParams {
  preset?: string;
  from?: string;
  to?: string;
  branchId?: string | number | null;
  forceRefresh?: boolean;
}

export interface MetricResponse {
  metricKey: string;
  title: string;
  unit: 'count' | 'percent';
  value: number;
  previous: number | null;
  deltaPct: number | null;
  scope: ScopeMode;
  branchIds: number[];
  computedAt: string;
  fromCache: boolean;
}

const DEFAULT_REFRESH_HOURS = 6;

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface EffectiveScope {
  scope: ScopeMode;
  branchIds: number[];
}

/**
 * يحصر الاتساع المطلوب ضمن قدرة منح المستخدم (§8.1):
 *   - GLOBAL: كل الفروع افتراضيًا؛ يجوز اختيار فرع واحد (drill-down).
 *   - BRANCH: مُقيّد بفروعه المسموحة؛ يجوز اختيار واحد منها.
 *   - ASSIGNED: مُقيّد بفروعه + إسناد السجلات إليه.
 * أي طلب لفرع خارج المسموح يُرفض.
 */
function resolveEffectiveScope(
  plan: { scope: ScopeMode; allowedBranchIds: number[] },
  params: GetMetricParams,
): EffectiveScope {
  const requestedBranchId = toPositiveInt(params.branchId);

  if (plan.scope === 'GLOBAL') {
    if (requestedBranchId != null) {
      return { scope: 'BRANCH', branchIds: [requestedBranchId] };
    }
    return { scope: 'GLOBAL', branchIds: [] };
  }

  // BRANCH / ASSIGNED — لا بدّ من فروع مسموحة.
  if (plan.allowedBranchIds.length === 0) {
    throw new ReportingError(403, 'الحساب غير مرتبط بأي فرع فعّال لعرض هذا المؤشر');
  }

  if (requestedBranchId != null) {
    if (!plan.allowedBranchIds.includes(requestedBranchId)) {
      throw new ReportingError(403, 'لا يمكنك عرض هذا المؤشر على فرع غير مسموح');
    }
    return { scope: plan.scope, branchIds: [requestedBranchId] };
  }

  return { scope: plan.scope, branchIds: plan.allowedBranchIds };
}

function buildSignature(scope: ScopeMode, branchIds: number[], userId: number, preset: string, bucketKey: string): string {
  const branchPart = branchIds.length > 0 ? [...branchIds].sort((a, b) => a - b).join(',') : 'all';
  const assignedPart = scope === 'ASSIGNED' ? `u${userId}` : '-';
  return `${scope}:${branchPart}:${assignedPart}:${preset}:${bucketKey}`;
}

function deltaPct(value: number, previous: number | null): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((value - previous) / previous) * 1000) / 10;
}

export async function getMetric(
  authContext: AuthContext,
  metricKey: string,
  params: GetMetricParams,
): Promise<MetricResponse> {
  const def = findMetric(metricKey);
  if (!def) {
    throw new ReportingError(404, 'المؤشر غير معروف');
  }

  const plan = resolveListAccessScope(authContext, def.permission);
  if (plan.scope === 'NONE') {
    throw new ReportingError(403, 'لا تملك صلاحية عرض هذا المؤشر');
  }

  // plan.scope is now narrowed to ScopeMode (NONE handled above).
  const { scope, branchIds } = resolveEffectiveScope(
    { scope: plan.scope, allowedBranchIds: plan.allowedBranchIds },
    params,
  );
  const tw = resolveTimeWindow(params.preset, params.from, params.to);
  const signature = buildSignature(scope, branchIds, authContext.userId, tw.preset, tw.bucketKey);
  const refreshHours = await getSystemSettingNumber('dashboard_metric_refresh_hours', DEFAULT_REFRESH_HOURS);

  // كاش: يُخدم إن كان ضمن فترة التحديث ولم يُطلب تحديث يدوي.
  if (tw.cacheable && !params.forceRefresh) {
    const cached = await readCache(metricKey, signature, refreshHours);
    if (cached) {
      return formatResponse(def, scope, branchIds, cached.value, cached.computedAt, true);
    }
  }

  const ctx: MetricComputeContext = {
    scope,
    branchIds,
    userId: authContext.userId,
    from: tw.from,
    to: tw.to,
    prevFrom: tw.prevFrom,
    prevTo: tw.prevTo,
  };
  const result = await def.compute(ctx);
  const computedAt = new Date();

  if (tw.cacheable) {
    await writeCache(metricKey, signature, result, computedAt, authContext.userId);
  }

  return formatResponse(def, scope, branchIds, result, computedAt.toISOString(), false);
}

function formatResponse(
  def: { key: string; titleAr: string; unit: 'count' | 'percent' },
  scope: ScopeMode,
  branchIds: number[],
  result: { value: number; previous: number | null },
  computedAt: string,
  fromCache: boolean,
): MetricResponse {
  return {
    metricKey: def.key,
    title: def.titleAr,
    unit: def.unit,
    value: result.value,
    previous: result.previous,
    deltaPct: deltaPct(result.value, result.previous),
    scope,
    branchIds,
    computedAt,
    fromCache,
  };
}

interface CachedRow {
  value: { value: number; previous: number | null };
  computedAt: string;
}

async function readCache(metricKey: string, signature: string, refreshHours: number): Promise<CachedRow | null> {
  const { rows } = await pool.query(
    `SELECT value, computed_at AS "computedAt"
       FROM metric_cache
      WHERE metric_key = $1 AND scope_signature = $2
        AND computed_at > NOW() - ($3 || ' hours')::interval
      LIMIT 1`,
    [metricKey, signature, String(Math.max(0, refreshHours))],
  );
  if (rows.length === 0) return null;
  return { value: rows[0].value, computedAt: new Date(rows[0].computedAt).toISOString() };
}

async function writeCache(
  metricKey: string,
  signature: string,
  result: { value: number; previous: number | null },
  computedAt: Date,
  userId: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO metric_cache (metric_key, scope_signature, value, computed_at, computed_by)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (metric_key, scope_signature)
       DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at, computed_by = EXCLUDED.computed_by`,
    [metricKey, signature, JSON.stringify(result), computedAt, userId],
  );
}
