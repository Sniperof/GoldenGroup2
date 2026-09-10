import type { AuthContext } from '@golden-crm/shared';
import {
  canCreateContractFromVisit,
  getEffectiveVisitSupervisorEmployeeId,
} from '../policies/contractCreationPolicy.js';

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

export class ContractCreationContextError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContractCreationContextError';
  }
}

export interface ContractCreationContext {
  visitId: number;
  branchId: number;
  visitStatus: string;
  saleOwnerId: number;
  customer: Record<string, any> & { id: number; name: string };
  deviceDemoTask: {
    visitTaskId: number;
    sourceOpenTaskId: number;
    status: string;
    finalDecision: string;
  };
  acceptedOfferCount: number;
  eligibleOffers: any[];
}

export async function loadContractCreationContext(
  db: Queryable,
  authContext: AuthContext,
  actorEmployeeId: number | null,
  visitId: number,
): Promise<ContractCreationContext> {
  const { rows: visitRows } = await db.query(
    `SELECT fv.id,
            fv.branch_id,
            fv.client_id,
            fv.status,
            fv.team_responsible_user_id,
            fv.team_snapshot,
            fv.reassigned_supervisor_id,
            fv.reassigned_technician_id,
            fv.reassigned_trainee_id,
            c.name AS client_name,
            c.mobile AS client_mobile,
            c.contacts AS client_contacts,
            c.father_name AS client_father_name,
            c.national_id AS client_national_id,
            c.mother_name AS client_mother_name,
            c.birth_date AS client_birth_date,
            c.gender AS client_gender,
            c.national_id_registry AS client_national_id_registry,
            c.national_id_issued_by AS client_national_id_issued_by,
            c.national_id_issue_date AS client_national_id_issue_date,
            c.national_id_box AS client_national_id_box,
            c.referrers AS client_referrers
       FROM field_visits fv
       JOIN clients c ON c.id = fv.client_id
      WHERE fv.id = $1
      LIMIT 1`,
    [visitId],
  );
  const visit = visitRows[0];
  if (!visit) {
    throw new ContractCreationContextError(404, 'VISIT_NOT_FOUND', 'الزيارة غير موجودة');
  }

  const access = canCreateContractFromVisit(authContext, visit, actorEmployeeId);
  if (!access.allowed) {
    const message = access.reason === 'ASSIGNMENT_FORBIDDEN'
      ? 'لا يمكنك إنشاء عقد من زيارة غير مسندة إليك'
      : 'لا تملك صلاحية إنشاء عقد ضمن فرع هذه الزيارة';
    throw new ContractCreationContextError(403, access.reason, message);
  }

  const saleOwnerId = getEffectiveVisitSupervisorEmployeeId(visit);
  if (saleOwnerId == null) {
    throw new ContractCreationContextError(
      409,
      'VISIT_SUPERVISOR_MISSING',
      'لا تملك الزيارة مشرفة مسؤولة صالحة لنسبة البيعة',
    );
  }

  const { rows: taskRows } = await db.query(
    `SELECT vt.id AS visit_task_id,
            vt.source_open_task_id,
            vt.status AS visit_task_status,
            vtr.final_decision
       FROM visit_tasks vt
       LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
      WHERE vt.field_visit_id = $1
        AND vt.task_type = 'device_demo'
      ORDER BY vt.sequence_no, vt.id`,
    [visitId],
  );

  if (taskRows.length !== 1) {
    throw new ContractCreationContextError(
      409,
      'DEVICE_DEMO_TASK_CARDINALITY_INVALID',
      taskRows.length === 0
        ? 'لا تحتوي الزيارة على مهمة عرض جهاز'
        : 'تحتوي الزيارة على أكثر من مهمة عرض جهاز وتحتاج تصحيح البيانات',
    );
  }

  const task = taskRows[0];
  const sourceOpenTaskId = toPositiveInteger(task.source_open_task_id);
  if (sourceOpenTaskId == null) {
    throw new ContractCreationContextError(
      409,
      'DEVICE_DEMO_SOURCE_TASK_MISSING',
      'مهمة عرض الجهاز غير مرتبطة بمهمة مفتوحة مصدرية',
    );
  }
  if (task.final_decision !== 'offer_presented') {
    throw new ContractCreationContextError(
      409,
      'DEVICE_DEMO_RESULT_NOT_ELIGIBLE',
      'يجب تسجيل نتيجة تقديم عرض قبل إنشاء العقد من الزيارة',
    );
  }

  const { rows: acceptedOffers } = await db.query(
    `SELECT otpo.id,
            otpo.device_model_id AS "deviceModelId",
            COALESCE(dm.name_ar, dm.name) AS "deviceName",
            otpo.offer_type AS "offerType",
            otpo.quantity,
            otpo.total_amount::float AS "totalAmount",
            otpo.first_payment_amount::float AS "firstPaymentAmount",
            otpo.installment_months AS "installmentMonths",
            otpo.currency,
            otpo.discount_percentage::float AS "discountPercentage",
            otpo.applied_device_discount_id AS "appliedDeviceDiscountId",
            otpo.closed_by_employee_id AS "closedByEmployeeId",
            otpo.sale_reference_number AS "saleReferenceNumber",
            live_contract.id AS "contractId",
            live_contract.contract_number AS "contractNumber"
       FROM open_task_pre_offers otpo
       JOIN customer_device_pre_offers customer_offer
         ON customer_offer.id = otpo.source_customer_pre_offer_id
        AND customer_offer.response_state = 'accepted'
       LEFT JOIN device_models dm ON dm.id = otpo.device_model_id
       LEFT JOIN LATERAL (
         SELECT c.id, c.contract_number
           FROM contracts c
          WHERE COALESCE(c.status, 'draft') NOT IN ('cancelled', 'discarded')
            AND (
              c.source_task_offer_id = otpo.id
              OR (
                NULLIF(BTRIM(otpo.sale_reference_number), '') IS NOT NULL
                AND BTRIM(c.sale_reference_number) = BTRIM(otpo.sale_reference_number)
              )
            )
          ORDER BY c.id DESC
          LIMIT 1
       ) live_contract ON TRUE
      WHERE otpo.open_task_id = $1
      ORDER BY otpo.id`,
    [sourceOpenTaskId],
  );

  if (acceptedOffers.length === 0) {
    throw new ContractCreationContextError(
      409,
      'ACCEPTED_OFFER_REQUIRED',
      'لا يوجد عرض مقبول يتيح إنشاء عقد من هذه الزيارة',
    );
  }

  return {
    visitId: Number(visit.id),
    branchId: Number(visit.branch_id),
    visitStatus: visit.status,
    saleOwnerId,
    customer: {
      id: Number(visit.client_id),
      name: visit.client_name,
      mobile: visit.client_mobile ?? '',
      contacts: visit.client_contacts ?? [],
      fatherName: visit.client_father_name ?? null,
      nationalId: visit.client_national_id ?? null,
      motherName: visit.client_mother_name ?? null,
      birthDate: visit.client_birth_date ?? null,
      gender: visit.client_gender ?? null,
      nationalIdRegistry: visit.client_national_id_registry ?? null,
      nationalIdIssuedBy: visit.client_national_id_issued_by ?? null,
      nationalIdIssueDate: visit.client_national_id_issue_date ?? null,
      nationalIdBox: visit.client_national_id_box ?? null,
      referrers: Array.isArray(visit.client_referrers) ? visit.client_referrers : [],
    },
    deviceDemoTask: {
      visitTaskId: Number(task.visit_task_id),
      sourceOpenTaskId,
      status: task.visit_task_status,
      finalDecision: task.final_decision,
    },
    acceptedOfferCount: acceptedOffers.length,
    eligibleOffers: acceptedOffers.filter(offer => offer.contractId == null),
  };
}

/**
 * Replace all client-controlled visit provenance with the authoritative context.
 * Mismatches are rejected instead of silently relinking a contract to another
 * client, task, branch, offer, or sale owner.
 */
export function bindContractInputToVisitContext(
  input: Record<string, any>,
  context: ContractCreationContext,
): Record<string, any> {
  assertOptionalIdMatches(input.customerId, context.customer.id, 'CONTEXT_CUSTOMER_MISMATCH', 'زبون العقد لا يطابق زبون الزيارة');
  assertOptionalIdMatches(input.branchId, context.branchId, 'CONTEXT_BRANCH_MISMATCH', 'فرع العقد لا يطابق فرع الزيارة');
  assertOptionalIdMatches(
    input.sourceOpenTaskId,
    context.deviceDemoTask.sourceOpenTaskId,
    'CONTEXT_TASK_MISMATCH',
    'مهمة مصدر العقد لا تطابق مهمة عرض الجهاز في الزيارة',
  );
  assertOptionalIdMatches(
    input.saleOwnerId,
    context.saleOwnerId,
    'CONTEXT_SALE_OWNER_MISMATCH',
    'صاحب البيعة لا يطابق المشرفة المسؤولة عن الزيارة',
  );

  const rawOfferId = input.sourceTaskOfferId;
  let selectedOffer: any | null = null;
  if (rawOfferId !== undefined && rawOfferId !== null && rawOfferId !== '') {
    const offerId = toPositiveInteger(rawOfferId);
    if (offerId == null) {
      throw new ContractCreationContextError(400, 'INVALID_SOURCE_OFFER_ID', 'معرف العرض المختار غير صالح');
    }
    selectedOffer = context.eligibleOffers.find(offer => Number(offer.id) === offerId) ?? null;
    if (!selectedOffer) {
      throw new ContractCreationContextError(
        409,
        'SOURCE_OFFER_NOT_ELIGIBLE',
        'العرض المختار غير مقبول أو لا يتبع هذه الزيارة أو مرتبط بعقد حي',
      );
    }

    const suppliedSaleReference = typeof input.saleReferenceNumber === 'string'
      ? input.saleReferenceNumber.trim()
      : '';
    const authoritativeSaleReference = typeof selectedOffer.saleReferenceNumber === 'string'
      ? selectedOffer.saleReferenceNumber.trim()
      : '';
    if (suppliedSaleReference && suppliedSaleReference !== authoritativeSaleReference) {
      throw new ContractCreationContextError(
        409,
        'CONTEXT_SALE_REFERENCE_MISMATCH',
        'رقم البيعة لا يطابق العرض المختار',
      );
    }
  }

  return {
    ...input,
    branchId: context.branchId,
    customerId: context.customer.id,
    customerName: context.customer.name,
    sourceVisitId: context.visitId,
    sourceOpenTaskId: context.deviceDemoTask.sourceOpenTaskId,
    sourceTaskOfferId: selectedOffer ? Number(selectedOffer.id) : null,
    saleReferenceNumber: selectedOffer?.saleReferenceNumber ?? null,
    saleOwnerId: context.saleOwnerId,
  };
}

export interface ExistingContractProvenance {
  customerId: number | null;
  customerName: string | null;
  sourceVisit: string | null;
  sourceVisitId: number | null;
  sourceOpenTaskId: number | null;
  sourceTaskOfferId: number | null;
  saleReferenceNumber: string | null;
  saleOwnerId: number | null;
}

/**
 * Source provenance describes how the contract was created, so an ordinary
 * draft edit must never manufacture, replace, or remove it. Historical rows
 * with missing links remain missing; repairing them requires a separate,
 * audited data-repair workflow.
 *
 * A visit-bound contract additionally freezes the visit's customer snapshot
 * and sale owner. Manual/legacy drafts keep their established customer and
 * owner editing behaviour.
 */
export function bindContractInputToExistingProvenance(
  input: Record<string, any>,
  existing: ExistingContractProvenance,
): Record<string, any> {
  assertImmutableNullableId(input, ['sourceVisitId', 'source_visit_id'], existing.sourceVisitId);
  assertImmutableNullableId(input, ['sourceOpenTaskId', 'source_open_task_id'], existing.sourceOpenTaskId);
  assertImmutableNullableId(input, ['sourceTaskOfferId', 'source_task_offer_id'], existing.sourceTaskOfferId);
  assertImmutableNullableText(input, ['sourceVisit', 'source_visit'], existing.sourceVisit);
  assertImmutableNullableText(input, ['saleReferenceNumber', 'sale_reference_number'], existing.saleReferenceNumber);

  if (existing.sourceVisitId != null) {
    assertImmutableNullableId(input, ['customerId', 'customer_id'], existing.customerId);
    assertImmutableNullableId(input, ['saleOwnerId', 'sale_owner_id'], existing.saleOwnerId);
    assertImmutableNullableText(input, ['customerName', 'customer_name'], existing.customerName);
  }

  return {
    ...input,
    sourceVisit: existing.sourceVisit,
    sourceVisitId: existing.sourceVisitId,
    sourceOpenTaskId: existing.sourceOpenTaskId,
    sourceTaskOfferId: existing.sourceTaskOfferId,
    saleReferenceNumber: existing.saleReferenceNumber,
    ...(existing.sourceVisitId != null
      ? {
          customerId: existing.customerId,
          customerName: existing.customerName,
          saleOwnerId: existing.saleOwnerId,
        }
      : {}),
  };
}

export function contractSourceUniquenessConflictPayload(error: unknown) {
  const pgError = error as { code?: string; constraint?: string } | null;
  if (pgError?.code !== '23505') return null;
  if (![
    'uq_contracts_live_source_task_offer',
    'uq_contracts_live_sale_reference',
  ].includes(pgError.constraint ?? '')) return null;

  return {
    error: 'هذا العرض مرتبط بعقد سابق — لا يمكن إنشاء عقد آخر على نفس البيعة',
    code: 'offer_already_contracted',
  };
}

function assertImmutableNullableId(
  input: Record<string, any>,
  keys: string[],
  existing: number | null,
) {
  const supplied = readProvidedValue(input, keys);
  if (!supplied.present) return;
  const normalized = supplied.value === null || supplied.value === ''
    ? null
    : toPositiveInteger(supplied.value);
  if (normalized !== existing) throwImmutableProvenanceError();
}

function assertImmutableNullableText(
  input: Record<string, any>,
  keys: string[],
  existing: string | null,
) {
  const supplied = readProvidedValue(input, keys);
  if (!supplied.present) return;
  const normalized = supplied.value === null || supplied.value === ''
    ? null
    : String(supplied.value);
  if (normalized !== existing) throwImmutableProvenanceError();
}

function readProvidedValue(input: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) {
      return { present: true, value: input[key] };
    }
  }
  return { present: false, value: undefined };
}

function throwImmutableProvenanceError(): never {
  throw new ContractCreationContextError(
    409,
    'CONTRACT_PROVENANCE_IMMUTABLE',
    'لا يمكن تغيير مصدر العقد أو بيانات الزيارة المثبتة بعد إنشائه',
  );
}

function assertOptionalIdMatches(
  supplied: unknown,
  expected: number,
  code: string,
  message: string,
) {
  if (supplied === undefined || supplied === null || supplied === '') return;
  const suppliedId = toPositiveInteger(supplied);
  if (suppliedId == null || suppliedId !== expected) {
    throw new ContractCreationContextError(409, code, message);
  }
}

function toPositiveInteger(value: unknown): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return Number.isInteger(numeric) && (numeric as number) > 0 ? (numeric as number) : null;
}
