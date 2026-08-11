import type { MetricComputeContext } from './metricsCatalog.js';
import { ReportingError } from './reportingError.js';

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

/**
 * Contracts are branch-only (no ASSIGNED tier — see
 * docs/analysis/contracts-records-performance-filters-and-stats.md §2): scope is
 * the branch filter alone. A viewer without BRANCH/GLOBAL contracts.view_list is
 * denied earlier by resolveListAccessScope (NONE), so no ASSIGNED handling is needed.
 */
export function appendContractScope(ctx: MetricComputeContext, params: QueryParams, alias = 'c'): string {
  return appendBranchScope(ctx, params, alias);
}

/**
 * Installed devices are branch-only (no ASSIGNED tier): scope is the branch
 * filter alone on installed_devices.branch_id. A viewer without BRANCH/GLOBAL
 * installed_devices.view is denied earlier (NONE).
 */
export function appendInstalledDeviceScope(ctx: MetricComputeContext, params: QueryParams, alias = 'd'): string {
  return appendBranchScope(ctx, params, alias);
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

// ── التوظيف (Jobs & Recruitment) ───────────────────────────────────────────────
// المفاتيح الثلاثة (jobs.applications/vacancies/interviews .view_list) تُعلن
// ASSIGNED ضمن allowed_scopes، لذا يجب معالجتها صراحةً هنا: تجاهلها يعني أن صاحب
// منحة ASSIGNED يرى أرقام الفرع كاملة (توسيع صامت للنطاق).

/** ASSIGNED على الطلبات = الطلبات التي أدخلها المستخدم (entered_by_user_id، أثر الإنشاء). */
export function appendApplicationScope(ctx: MetricComputeContext, params: QueryParams, alias = 'ja'): string {
  let sql = appendBranchScope(ctx, params, alias);
  if (ctx.scope === 'ASSIGNED') {
    params.push(ctx.userId);
    sql += ` AND ${alias}.entered_by_user_id = $${params.length}`;
  }
  return sql;
}

/**
 * الشاغر لا يملك عمود ملكية/إسناد إطلاقاً، فلا معنى شخصي لـ ASSIGNED عليه.
 * يُرفض صراحةً (fail closed) بدل إظهار أرقام الفرع كاملة أو صفر صامت — نظير
 * planning.manage في planning-contact-targets §7.1.
 */
export function appendVacancyScope(ctx: MetricComputeContext, params: QueryParams, alias = 'jv'): string {
  if (ctx.scope === 'ASSIGNED') {
    throw new ReportingError(403, 'لا يوجد عرض شخصي لمؤشرات الشواغر — تحتاج اتساع الفرع أو أعلى');
  }
  return appendBranchScope(ctx, params, alias);
}

/**
 * المقابلات بلا branch_id؛ نطاقها مشتقّ عبر الطلب (interviews → job_applications).
 * ASSIGNED = المقابلات التي يجريها المستخدم نفسه (interviewer_user_id).
 */
export function appendInterviewScope(ctx: MetricComputeContext, params: QueryParams, alias = 'i'): string {
  let sql = '';
  if (ctx.branchIds.length > 0) {
    params.push(ctx.branchIds);
    sql += ` AND EXISTS (SELECT 1 FROM job_applications ja_scope
                          WHERE ja_scope.id = ${alias}.application_id
                            AND ja_scope.branch_id = ANY($${params.length}))`;
  }
  if (ctx.scope === 'ASSIGNED') {
    params.push(ctx.userId);
    sql += ` AND ${alias}.interviewer_user_id = $${params.length}`;
  }
  return sql;
}

/**
 * audit_logs بلا branch_id؛ نطاقه مشتقّ عبر الطلب المرتبط (application_id).
 * يُستعمل لمؤشرات زمن الدورة المبنية على انتقالات المراحل.
 */
export function appendAuditApplicationScope(ctx: MetricComputeContext, params: QueryParams, alias = 'al'): string {
  const conds: string[] = [];
  if (ctx.branchIds.length > 0) {
    params.push(ctx.branchIds);
    conds.push(`ja_scope.branch_id = ANY($${params.length})`);
  }
  if (ctx.scope === 'ASSIGNED') {
    params.push(ctx.userId);
    conds.push(`ja_scope.entered_by_user_id = $${params.length}`);
  }
  if (conds.length === 0) return '';
  return ` AND EXISTS (SELECT 1 FROM job_applications ja_scope
                        WHERE ja_scope.id = ${alias}.application_id
                          AND ${conds.join(' AND ')})`;
}

/**
 * direct_suggestions has no branch_id of its own; its scope is derived through the
 * originating visit: direct_suggestions → visit_tasks → field_visits.branch_id.
 * ASSIGNED narrows to visits the user leads (field_visits.team_responsible_user_id)
 * so a supervisor sees only their own field-collected suggestions, never the branch.
 */
export function appendDirectSuggestionScope(ctx: MetricComputeContext, params: QueryParams, alias = 'ds'): string {
  const conds: string[] = [];
  if (ctx.branchIds.length > 0) {
    params.push(ctx.branchIds);
    conds.push(`fv.branch_id = ANY($${params.length})`);
  }
  if (ctx.scope === 'ASSIGNED') {
    params.push(ctx.userId);
    conds.push(`fv.team_responsible_user_id = $${params.length}`);
  }
  if (conds.length === 0) return '';
  return ` AND ${alias}.visit_task_id IN (
            SELECT vt.id FROM visit_tasks vt
              JOIN field_visits fv ON fv.id = vt.field_visit_id
             WHERE ${conds.join(' AND ')})`;
}
