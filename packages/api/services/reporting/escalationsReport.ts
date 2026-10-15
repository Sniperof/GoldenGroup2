import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';
import { damascusDayBounds, reportDateFilter } from './fieldWorkLaterals.js';

interface QueryOptions { offset?: number; limit: number; includeTotalRows?: boolean }

export interface EscalationRow {
  source: string;
  sourceId: number;
  branchName: string;
  escalationType: string;
  reference: string | null;
  customerName: string | null;
  escalatedAt: string;
  escalatedBy: string | null;
  reason: string | null;
  level: number | null;
  responsibleName: string | null;
  stateLabel: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  durationHours: string | null;
  openOverDay: string | null;
}

/** The two escalation types that are not a service-request type. */
export const VISIT_ESCALATION_TYPES = {
  visit_undocumented: 'زيارة غير موثّقة',
  visit_not_started: 'زيارة لم تبدأ',
} as const;

/** A service-request type is offered as `sr:<request_type>`, so it never collides with the visit ones. */
const SERVICE_REQUEST_TYPE_PREFIX = 'sr:';

/**
 * Account-creation requests are a GLOBAL-only family in the system, so the report
 * shows them to GLOBAL alone — it must not widen who sees them (DEC-ESC-6).
 */
const GLOBAL_ONLY_REQUEST_TYPES_SQL = `('account_creation')`;

const ESCALATION_STATES = new Set(['open', 'closed']);

const STATE_LABELS_SQL = `CASE cases.state
             WHEN 'open' THEN 'مفتوحة'
             WHEN 'resolved' THEN 'محلولة'
             WHEN 'rejected' THEN 'انتهت برفض'
             WHEN 'request_closed' THEN 'أُغلق الطلب'
             WHEN 'cancelled' THEN 'انتهت بالإلغاء'
             WHEN 'superseded' THEN 'أُغلقت بتصعيد جديد'
           END`;

function userNameSql(alias: string): string {
  return `COALESCE(NULLIF(BTRIM(${alias}_employee.name), ''), NULLIF(BTRIM(${alias}.name), ''), NULLIF(BTRIM(${alias}.username), ''))`;
}

function parseEscalationType(value: unknown): { requestType: string | null; visitType: string | null } | null {
  if (value == null || value === '') return null;
  const normalized = String(value);
  if (normalized in VISIT_ESCALATION_TYPES) return { requestType: null, visitType: normalized };
  if (normalized.startsWith(SERVICE_REQUEST_TYPE_PREFIX) && /^[a-z_]{2,60}$/.test(normalized.slice(3))) {
    return { requestType: normalized.slice(3), visitType: null };
  }
  throw new ReportingError(400, 'نوع التصعيد غير صالح');
}

/**
 * One row per escalation CASE (DEC-ESC-1), from three sources reduced to one row per
 * case before they are unioned, so a visit never multiplies by its tiers:
 *
 * - service requests: read from the protected audit log, because the request row
 *   keeps only the escalation in progress and clears it on resolve (§9.1). The case
 *   ends at the first exit event after it (DEC-ESC-3).
 * - undocumented visits: one case per visit, at its deepest tier; resolved when the
 *   visit left in_progress/ended (DEC-ESC-4/5).
 * - visits that never started: one alert row each, with its own resolved_at.
 *
 * The period applies to the moment of escalation. Open cases are measured to NOW(),
 * which is fixed for the statement, so every page of the snapshot agrees.
 */
export function buildEscalationsQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const caseFilters: string[] = [];

  const fromDate = reportDateFilter(request.fromDate, 'بداية المدة');
  const toDate = reportDateFilter(request.toDate, 'نهاية المدة');
  if (!fromDate || !toDate) throw new ReportingError(400, 'مدة التقرير مطلوبة لتوليده');
  if (fromDate > toDate) throw new ReportingError(400, 'بداية المدة يجب ألا تكون بعد نهايتها');
  params.push(fromDate);
  const fromRef = `$${params.length}`;
  params.push(toDate);
  const toRef = `$${params.length}`;
  const { fromStampSql, toStampSql } = damascusDayBounds(fromRef, toRef);

  if (access.branchIds.length > 0) {
    // A request with no branch has no branch to match, so it drops out here: it is
    // visible under an unfiltered GLOBAL scope alone.
    params.push(access.branchIds);
    caseFilters.push(`cases.branch_id = ANY($${params.length}::int[])`);
  }
  if (access.scope !== 'GLOBAL') caseFilters.push('NOT cases.global_only');
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    caseFilters.push(`cases.responsible_user_id = $${params.length}`);
  }

  const type = parseEscalationType(request.escalationType);
  if (type?.visitType) {
    params.push(type.visitType);
    caseFilters.push(`cases.source = $${params.length}`);
  } else if (type?.requestType) {
    params.push(type.requestType);
    caseFilters.push(`cases.source = 'service_request' AND cases.request_type = $${params.length}`);
  }

  const state = request.escalationState == null || request.escalationState === ''
    ? null : String(request.escalationState);
  if (state != null && !ESCALATION_STATES.has(state)) throw new ReportingError(400, 'حالة التصعيد غير صالحة');
  if (state === 'open') caseFilters.push(`cases.state = 'open'`);
  if (state === 'closed') caseFilters.push(`cases.state <> 'open'`);

  params.push(options.limit);
  const limitRef = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  const sql = `
    WITH sr_escalations AS (
      SELECT log.id AS escalation_log_id,
             log.service_request_id,
             log.created_at AS escalated_at,
             log.actor_user_id AS escalated_by_user_id,
             NULLIF(BTRIM(log.event_payload->>'reason'), '') AS reason
        FROM service_request_audit_log log
       WHERE log.event_type = 'escalated_to_audit_admin'
         AND log.created_at >= ${fromStampSql}
         AND log.created_at < ${toStampSql}
    ), sr_cases AS (
      SELECT 'service_request'::text AS source,
             escalation.escalation_log_id::bigint AS source_id,
             request.branch_id,
             request.request_type,
             COALESCE(NULLIF(BTRIM(type_config.label_ar), ''), request.request_type) AS type_label,
             request.public_ref_number::text AS reference,
             request.beneficiary_client_id AS client_id,
             request.beneficiary_candidate_id AS candidate_id,
             escalation.escalated_at,
             escalation.escalated_by_user_id,
             escalation.reason,
             NULL::int AS tier,
             request.reviewed_by_user_id AS responsible_user_id,
             -- The first exit after the escalation closes it (DEC-ESC-3). A second
             -- escalation before any exit closes the first without a recorded
             -- resolution — the system refuses that today (already_escalated).
             CASE
               WHEN exit_event.event_type IS NULL THEN 'open'
               WHEN exit_event.event_type = 'escalation_resolved' THEN 'resolved'
               WHEN exit_event.event_type = 'rejected_decision'
                 OR exit_event.to_status = 'rejected' THEN 'rejected'
               WHEN exit_event.event_type = 'escalated_to_audit_admin' THEN 'superseded'
               ELSE 'request_closed'
             END AS state,
             CASE WHEN exit_event.event_type = 'escalated_to_audit_admin' THEN NULL
                  ELSE exit_event.created_at END AS resolved_at,
             CASE WHEN exit_event.event_type = 'escalated_to_audit_admin' THEN NULL
                  ELSE exit_event.actor_user_id END AS resolved_by_user_id,
             request.request_type IN ${GLOBAL_ONLY_REQUEST_TYPES_SQL} AS global_only
        FROM sr_escalations escalation
        JOIN service_requests request ON request.id = escalation.service_request_id
        LEFT JOIN service_request_type_config type_config ON type_config.request_type = request.request_type
        LEFT JOIN LATERAL (
          SELECT exit_log.event_type,
                 exit_log.event_payload->>'to' AS to_status,
                 exit_log.created_at,
                 exit_log.actor_user_id
            FROM service_request_audit_log exit_log
           WHERE exit_log.service_request_id = escalation.service_request_id
             AND (exit_log.created_at, exit_log.id) > (escalation.escalated_at, escalation.escalation_log_id)
             AND (
               exit_log.event_type IN ('escalation_resolved', 'rejected_decision', 'escalated_to_audit_admin')
               OR (exit_log.event_type = 'status_changed'
                   AND exit_log.event_payload->>'to' IN ('rejected', 'cancelled', 'promoted', 'resolved_at_intake'))
             )
           ORDER BY exit_log.created_at ASC, exit_log.id ASC
           LIMIT 1
        ) exit_event ON TRUE
    ), visit_undocumented AS (
      -- The tiers are the depth of one case, not cases of their own (DEC-ESC-5).
      SELECT 'visit_undocumented'::text AS source,
             visit.id::bigint AS source_id,
             visit.branch_id,
             NULL::text AS request_type,
             '${VISIT_ESCALATION_TYPES.visit_undocumented}'::text AS type_label,
             visit.id::text AS reference,
             visit.client_id,
             NULL::int AS candidate_id,
             alerts.first_alerted_at AS escalated_at,
             NULL::int AS escalated_by_user_id,
             'لم تُوثَّق ضمن مهلة التوثيق بعد بدئها'::text AS reason,
             alerts.max_tier AS tier,
             visit.team_responsible_user_id AS responsible_user_id,
             CASE
               WHEN visit.status IN ('in_progress', 'ended') THEN 'open'
               WHEN visit.status = 'cancelled' THEN 'cancelled'
               ELSE 'resolved'
             END AS state,
             -- A cancelled visit carries no closed_at and no cancellation time.
             CASE WHEN visit.status IN ('in_progress', 'ended', 'cancelled') THEN NULL
                  ELSE visit.closed_at END AS resolved_at,
             NULL::int AS resolved_by_user_id,
             FALSE AS global_only
        FROM (
          SELECT alert.visit_id,
                 MIN(alert.alerted_at) AS first_alerted_at,
                 MAX(alert.tier)::int AS max_tier
            FROM visit_escalation_alerts alert
           GROUP BY alert.visit_id
        ) alerts
        JOIN field_visits visit ON visit.id = alerts.visit_id
       WHERE alerts.first_alerted_at >= ${fromStampSql}
         AND alerts.first_alerted_at < ${toStampSql}
    ), visit_not_started AS (
      SELECT 'visit_not_started'::text AS source,
             alert.id::bigint AS source_id,
             visit.branch_id,
             NULL::text AS request_type,
             '${VISIT_ESCALATION_TYPES.visit_not_started}'::text AS type_label,
             visit.id::text AS reference,
             visit.client_id,
             NULL::int AS candidate_id,
             alert.alerted_at AS escalated_at,
             NULL::int AS escalated_by_user_id,
             'فات موعدها ولم تبدأ'::text AS reason,
             NULL::int AS tier,
             alert.responsible_user_id,
             CASE WHEN alert.resolved_at IS NULL THEN 'open' ELSE 'resolved' END AS state,
             alert.resolved_at,
             NULL::int AS resolved_by_user_id,
             FALSE AS global_only
        FROM visit_scheduled_alerts alert
        JOIN field_visits visit ON visit.id = alert.visit_id
       WHERE alert.alerted_at >= ${fromStampSql}
         AND alert.alerted_at < ${toStampSql}
    ), cases AS (
      SELECT * FROM sr_cases
      UNION ALL SELECT * FROM visit_undocumented
      UNION ALL SELECT * FROM visit_not_started
    )
    SELECT cases.source AS "source",
           cases.source_id AS "sourceId",
           COALESCE(NULLIF(BTRIM(branch.name), ''), 'غير محدد') AS "branchName",
           cases.type_label AS "escalationType",
           cases.reference AS "reference",
           COALESCE(
             NULLIF(BTRIM(client.name), ''),
             NULLIF(BTRIM(CONCAT_WS(' ', client.first_name, client.last_name)), ''),
             NULLIF(BTRIM(CONCAT_WS(' ', candidate.first_name, candidate.last_name)), '')
           ) AS "customerName",
           cases.escalated_at AS "escalatedAt",
           CASE WHEN cases.source = 'service_request' THEN ${userNameSql('escalator')}
                ELSE 'النظام' END AS "escalatedBy",
           cases.reason AS "reason",
           cases.tier AS "level",
           ${userNameSql('responsible')} AS "responsibleName",
           ${STATE_LABELS_SQL} AS "stateLabel",
           cases.resolved_at AS "resolvedAt",
           ${userNameSql('resolver')} AS "resolvedBy",
           ROUND((EXTRACT(EPOCH FROM (
             COALESCE(cases.resolved_at, CASE WHEN cases.state = 'open' THEN NOW() END) - cases.escalated_at
           )) / 3600)::numeric, 1) AS "durationHours",
           CASE WHEN cases.state = 'open' AND NOW() - cases.escalated_at > INTERVAL '24 hours'
                THEN 'نعم' END AS "openOverDay"
           ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM cases
      LEFT JOIN branches branch ON branch.id = cases.branch_id
      LEFT JOIN clients client ON client.id = cases.client_id
      LEFT JOIN candidates candidate ON candidate.id = cases.candidate_id
      LEFT JOIN hr_users escalator ON escalator.id = cases.escalated_by_user_id
      LEFT JOIN employees escalator_employee ON escalator_employee.id = escalator.employee_id
      LEFT JOIN hr_users responsible ON responsible.id = cases.responsible_user_id
      LEFT JOIN employees responsible_employee ON responsible_employee.id = responsible.employee_id
      LEFT JOIN hr_users resolver ON resolver.id = cases.resolved_by_user_id
      LEFT JOIN employees resolver_employee ON resolver_employee.id = resolver.employee_id
     ${caseFilters.length ? `WHERE ${caseFilters.join('\n       AND ')}` : ''}
     ORDER BY ${buildTabularReportOrderBy(
       'daily_work.escalations', access, request,
       `CASE WHEN cases.state = 'open' THEN 0 ELSE 1 END ASC, cases.escalated_at ASC, cases.source ASC, cases.source_id ASC`,
     )}
     LIMIT ${limitRef}${offsetSql}
  `;
  return { sql, params };
}

export async function getEscalationsReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildEscalationsQuery(access, request, options);
  const { rows } = await pool.query<EscalationRow>(query.sql, query.params);
  return { rows, total: rows.length };
}

/**
 * The type picker offers the request types from the admin registry plus the two
 * visit escalations. Account creation is offered to GLOBAL alone, the only scope
 * that can see it.
 */
export async function getEscalationsFilterOptions(
  access: TabularReportAccess,
): Promise<Partial<TabularReportFilterOptions>> {
  const { rows } = await pool.query(`
    SELECT '${SERVICE_REQUEST_TYPE_PREFIX}' || config.request_type AS value,
           COALESCE(NULLIF(BTRIM(config.label_ar), ''), config.request_type) AS label
      FROM service_request_type_config config
     WHERE ($1::boolean OR config.request_type NOT IN ${GLOBAL_ONLY_REQUEST_TYPES_SQL})
     ORDER BY config.display_order NULLS LAST, label
  `, [access.scope === 'GLOBAL']);
  return {
    escalationTypes: [
      ...rows.map(row => ({ value: String(row.value), label: String(row.label) })),
      ...Object.entries(VISIT_ESCALATION_TYPES).map(([value, label]) => ({ value, label })),
    ],
  };
}
