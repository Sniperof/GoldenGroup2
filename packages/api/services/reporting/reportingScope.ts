import type { MetricComputeContext } from './metricsCatalog.js';

type QueryParams = unknown[];

function appendBranchScope(ctx: MetricComputeContext, params: QueryParams, alias: string): string {
  if (ctx.branchIds.length === 0) return '';
  params.push(ctx.branchIds);
  return ` AND ${alias}.branch_id = ANY($${params.length})`;
}

/** Matches the canonical clients list: ASSIGNED is backed by client_assignments. */
export function appendClientScope(ctx: MetricComputeContext, params: QueryParams, alias = 'c'): string {
  let sql = appendBranchScope(ctx, params, alias);
  if (ctx.scope === 'ASSIGNED') {
    params.push(ctx.userId);
    sql += ` AND EXISTS (SELECT 1 FROM client_assignments ca
                          WHERE ca.client_id = ${alias}.id AND ca.hr_user_id = $${params.length})`;
  }
  return sql;
}

/** Matches GET /api/candidates: ASSIGNED is the M2M candidate_assignments relation. */
export function appendCandidateScope(ctx: MetricComputeContext, params: QueryParams, alias = 'c'): string {
  let sql = appendBranchScope(ctx, params, alias);
  if (ctx.scope === 'ASSIGNED') {
    params.push(ctx.userId);
    sql += ` AND EXISTS (SELECT 1 FROM candidate_assignments ca_scope
                          WHERE ca_scope.candidate_id = ${alias}.id
                            AND ca_scope.hr_user_id = $${params.length})`;
  }
  return sql;
}

/** Matches GET /api/referral-sheets: ASSIGNED means the reviewer assigned to the sheet. */
export function appendReferralSheetScope(ctx: MetricComputeContext, params: QueryParams, alias = 's'): string {
  let sql = appendBranchScope(ctx, params, alias);
  if (ctx.scope === 'ASSIGNED') {
    params.push(ctx.userId);
    sql += ` AND ${alias}.assigned_hr_user_id = $${params.length}`;
  }
  return sql;
}
