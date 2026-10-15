import { ReportingError } from './reportingError.js';

/**
 * Pieces shared by the field-work reports whose row is a person on the visit team
 * (عمل الفنيين، عمل المشرفات). Each report builds an `executed` CTE carrying the
 * person's id under its own column name, and these laterals read it — so a fix to
 * how money, agreements, sales or names are counted reaches both reports at once.
 */

/** A sale is what counts as a sale in every other report (§1.2). */
export const COUNTED_CONTRACT_STATUSES_SQL = `('active', 'completed')`;

/** `contracts.contract_date` is VARCHAR, so it is read behind a shape guard. */
export const CONTRACT_DATE_SHAPE_SQL = `contract.contract_date ~ '^\\d{4}-\\d{2}-\\d{2}$'`;

/** The movement sources that are contract money, as the department results report reads them. */
const CONTRACT_MONEY_SOURCES_SQL = `('contract', 'contract_installment', 'contract_payment')`;

/** Which column of `executed` names the person the row is about. */
export type ExecutedPersonColumn = 'technician_id' | 'supervisor_id';

export function reportDateFilter(value: unknown, label: string): string | null {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : null;
  if (normalized == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

/** Damascus day boundaries as timestamps, so the filters stay indexable. */
export function damascusDayBounds(fromRef: string, toRef: string): { fromStampSql: string; toStampSql: string } {
  return {
    fromStampSql: `(${fromRef}::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`,
    toStampSql: `((${toRef}::text::date + 1)::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`,
  };
}

export function periodicMoneyLateral(person: ExecutedPersonColumn): string {
  return `LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(movement.amount_syp), 0)::numeric AS collected
          FROM executed
          JOIN financial_movements movement
            ON movement.source_type = 'periodic_maintenance'
           AND movement.kind = 'payment'
           AND movement.source_id = executed.source_open_task_id
         WHERE executed.${person} = row.id
           AND executed.task_type = 'periodic_maintenance'
      ) periodic_money ON TRUE`;
}

export function emergencyMoneyLateral(person: ExecutedPersonColumn): string {
  return `LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(financials.collected_amount), 0)::numeric AS collected
          FROM executed
          JOIN visit_task_emergency_financials financials
            ON financials.visit_task_result_id = executed.result_id
         WHERE executed.${person} = row.id
      ) emergency_money ON TRUE`;
}

export function duesLateral(person: ExecutedPersonColumn): string {
  return `LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(collection.paid_amount_syp)
                 FILTER (WHERE collection.receivable_source_type = 'contract'), 0)::numeric AS contract_dues,
               COALESCE(SUM(collection.paid_amount_syp)
                 FILTER (WHERE collection.receivable_source_type IS DISTINCT FROM 'contract'), 0)::numeric AS service_dues
          FROM executed
          JOIN visit_task_installment_collection_results collection
            ON collection.visit_task_result_id = executed.result_id
         WHERE executed.${person} = row.id
      ) dues ON TRUE`;
}

export function agreementsLateral(person: ExecutedPersonColumn): string {
  return `LEFT JOIN LATERAL (
        -- Distinct agreement: two visits of the same agreement performed by the same
        -- person must not add its fee twice.
        SELECT COALESCE(SUM(agreement.fee_syp), 0)::numeric AS value
          FROM (
            SELECT DISTINCT payload.service_agreement_id AS agreement_id
              FROM executed
              JOIN open_task_periodic_payload payload
                ON payload.open_task_id = executed.source_open_task_id
             WHERE executed.${person} = row.id
               AND payload.service_agreement_id IS NOT NULL
          ) linked
          JOIN service_agreements agreement ON agreement.id = linked.agreement_id
      ) agreements ON TRUE`;
}

/**
 * The contracts the row's person owns as seller, dated inside the period. With
 * `firstPayment`, it also sums each definitive sale's first collected payment — the
 * same «first payment» the department results report reads, so the two agree.
 */
export function ownedSalesLateral(fromRef: string, toRef: string, options: { firstPayment?: boolean } = {}): string {
  const firstPaymentSelect = options.firstPayment
    ? `,
               COALESCE(SUM(first_payment.amount_syp)
                 FILTER (WHERE contract.sale_subtype = 'definitive'
                           AND contract.status IN ${COUNTED_CONTRACT_STATUSES_SQL}), 0)::numeric AS first_payments`
    : '';
  const firstPaymentJoin = options.firstPayment
    ? `
          LEFT JOIN LATERAL (
            SELECT movement.amount_syp
              FROM financial_movements movement
             WHERE movement.contract_id = contract.id
               AND movement.kind = 'payment'
               AND movement.source_type IN ${CONTRACT_MONEY_SOURCES_SQL}
             ORDER BY movement.occurred_at ASC, movement.id ASC
             LIMIT 1
          ) first_payment ON TRUE`
    : '';
  return `LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE contract.sale_subtype = 'definitive'
                                  AND contract.status IN ${COUNTED_CONTRACT_STATUSES_SQL})::int AS definitive_sales,
               COUNT(*) FILTER (WHERE contract.sale_subtype = 'temporary'
                                  AND contract.status <> 'cancelled')::int AS temporary_contracts${firstPaymentSelect}
          FROM contracts contract${firstPaymentJoin}
         WHERE contract.sale_owner_id = row.id
           AND ${CONTRACT_DATE_SHAPE_SQL}
           AND contract.contract_date >= ${fromRef}::text
           AND contract.contract_date <= ${toRef}::text
      ) sales ON TRUE`;
}

export function candidatesAddedLateral(fromStampSql: string, toStampSql: string): string {
  return `LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS candidates_added
          FROM candidates candidate
          JOIN hr_users owner_account ON owner_account.id = candidate.owner_user_id
         WHERE owner_account.employee_id = row.id
           AND candidate.created_at >= ${fromStampSql}
           AND candidate.created_at < ${toStampSql}
      ) names ON TRUE`;
}
