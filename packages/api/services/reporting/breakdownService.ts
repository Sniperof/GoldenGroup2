// ============================================================
// breakdownService.ts — تنفيذ مؤشر تجميعي مع التقييد بالنطاق والكاش
// (نظير metricsService للمؤشرات القياسية؛ reporting-analytics §1.1/§7/§8.1)
// ============================================================
// يعيد استخدام منطق التقييد الأمني نفسه (resolveEffectiveScope/buildSignature
// من metricsService) فلا يتفرّع منطق الصلاحيات. الكاش يشترك في جدول metric_cache
// (value jsonb يحمل {groups}) — مفتاح المؤشر فريد فلا تصادم مع القياسية.
// ============================================================

import type { AuthContext } from '@golden-crm/shared';
import pool from '../../db.js';
import { resolveListAccessScope } from '../authorizationService.js';
import { getSystemSettingNumber } from '../systemSettings.js';
import { findBreakdown, type BreakdownDefinition, type BreakdownGroup, type BreakdownKind } from './breakdownCatalog.js';
import type { MetricComputeContext, ScopeMode } from './metricsCatalog.js';
import { resolveTimeWindow } from './timeWindow.js';
import { ReportingError, resolveEffectiveScope, buildSignature, type GetMetricParams } from './metricsService.js';

const DEFAULT_REFRESH_HOURS = 6;

export interface BreakdownResponse {
  metricKey: string;
  title: string;
  kind: BreakdownKind;
  valueUnit: 'count' | 'percent';
  secondaryLabel: string | null;
  groups: BreakdownGroup[];
  total: number;
  scope: ScopeMode;
  branchIds: number[];
  computedAt: string;
  fromCache: boolean;
}

export async function getBreakdown(
  authContext: AuthContext,
  metricKey: string,
  params: GetMetricParams,
): Promise<BreakdownResponse> {
  const def = findBreakdown(metricKey);
  if (!def) {
    throw new ReportingError(404, 'المؤشر التجميعي غير معروف');
  }

  const plan = resolveListAccessScope(authContext, def.permission);
  if (plan.scope === 'NONE') {
    throw new ReportingError(403, 'لا تملك صلاحية عرض هذا المؤشر');
  }

  const { scope, branchIds } = resolveEffectiveScope(
    { scope: plan.scope, allowedBranchIds: plan.allowedBranchIds },
    params,
  );
  const tw = resolveTimeWindow(params.preset, params.from, params.to);
  const signature = buildSignature(scope, branchIds, authContext.userId, tw.preset, tw.bucketKey);
  const refreshHours = await getSystemSettingNumber('dashboard_metric_refresh_hours', DEFAULT_REFRESH_HOURS);

  if (tw.cacheable && !params.forceRefresh) {
    const cached = await readCache(metricKey, signature, refreshHours);
    if (cached) {
      return formatResponse(def, scope, branchIds, cached.groups, cached.computedAt, true);
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
  const groups = await def.compute(ctx);
  const computedAt = new Date();

  if (tw.cacheable) {
    await writeCache(metricKey, signature, groups, computedAt, authContext.userId);
  }

  return formatResponse(def, scope, branchIds, groups, computedAt.toISOString(), false);
}

function formatResponse(
  def: BreakdownDefinition,
  scope: ScopeMode,
  branchIds: number[],
  groups: BreakdownGroup[],
  computedAt: string,
  fromCache: boolean,
): BreakdownResponse {
  return {
    metricKey: def.key,
    title: def.titleAr,
    kind: def.kind,
    valueUnit: def.valueUnit ?? 'count',
    secondaryLabel: def.secondaryLabel ?? null,
    groups,
    total: groups.reduce((sum, g) => sum + g.value, 0),
    scope,
    branchIds,
    computedAt,
    fromCache,
  };
}

async function readCache(
  metricKey: string,
  signature: string,
  refreshHours: number,
): Promise<{ groups: BreakdownGroup[]; computedAt: string } | null> {
  const { rows } = await pool.query(
    `SELECT value, computed_at AS "computedAt"
       FROM metric_cache
      WHERE metric_key = $1 AND scope_signature = $2
        AND computed_at > NOW() - ($3 || ' hours')::interval
      LIMIT 1`,
    [metricKey, signature, String(Math.max(0, refreshHours))],
  );
  if (rows.length === 0) return null;
  const val = rows[0].value;
  const groups: BreakdownGroup[] = Array.isArray(val?.groups) ? val.groups : [];
  return { groups, computedAt: new Date(rows[0].computedAt).toISOString() };
}

async function writeCache(
  metricKey: string,
  signature: string,
  groups: BreakdownGroup[],
  computedAt: Date,
  userId: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO metric_cache (metric_key, scope_signature, value, computed_at, computed_by)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (metric_key, scope_signature)
       DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at, computed_by = EXCLUDED.computed_by`,
    [metricKey, signature, JSON.stringify({ groups }), computedAt, userId],
  );
}
