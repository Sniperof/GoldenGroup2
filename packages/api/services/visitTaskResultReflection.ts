// ============================================================
// visitTaskResultReflection.ts
// ============================================================
// Unified service that writes a visit_task result and reflects its
// effect onto the parent open_task. Per the device-demo constitution:
//
//   docs/constitution/features/tasks/device-demo.md
//
// Public entry point for device_demo:
//   applyDeviceDemoResult(db, visitTaskId, body, performedByUserId)
//
// Responsibilities (in order, inside a single transaction):
//   1. Load and validate the visit_task / field_visit / open_task.
//   2. Write the visit_task_results row.
//   3. Write the visit_task_device_demo_results side table.
//   4. Write per-offer rows to customer_pre_offers (offer_presented only).
//   5. Update visit_tasks.status.
//   6. Reflect onto open_task.status + expected_date.
//   7. Call checkAndCompleteVisit() to advance the visit if guards pass.
//
// Contract creation + cascading delivery/installation/activation are
// flagged on the return value (`cascadeHints`) and handled by the
// caller in a follow-up pass — keeping this service focused on result
// reflection.
// ============================================================

import type { PoolClient } from 'pg';
import pool from '../db.js';
import { checkAndCompleteVisit } from './visitCompletion.js';

export type DeviceDemoFinalDecision =
  | 'offer_presented'
  | 'device_sold'
  | 'rescheduled'
  | 'cancelled';

export type DeviceDeliveryFinalDecision =
  | 'delivered_successfully'
  | 'customer_not_available'
  | 'wrong_address'
  | 'refused_delivery';

export type DeviceInstallationFinalDecision =
  | 'installed_successfully'
  | 'installation_incomplete'
  | 'refused_installation';

export type DeviceActivationFinalDecision =
  | 'activated_successfully'
  | 'activation_failed'
  | 'device_issue';

export type CustomerResponse = 'accepted' | 'rejected' | 'extension_requested';

export interface OfferInput {
  device_model_id: number;
  offer_type: 'cash' | 'installment';
  quantity: number;
  total_amount: number;
  currency: string;
  first_payment_amount?: number | null;
  installment_months?: number | null;
  discount_percentage?: number | null;
  applied_device_discount_id?: number | null;
  closed_by_employee_id?: number | null;
  customer_response: CustomerResponse;
  /** Free-text refusal reason. Required when customer_response='rejected'. */
  no_closing_reason?: string | null;
  sale_reference_number?: string | null;
  source_customer_pre_offer_id?: number | null;
  /**
   * Existing open_task_pre_offers.id when the offer was loaded from the task.
   * Used as the primary UPDATE key so result recording mutates the existing
   * row instead of inserting a duplicate when source_customer_pre_offer_id
   * is NULL (e.g. offers authored manually in DeviceOfferModal pre migration).
   */
  open_task_pre_offer_id?: number | null;
}

export interface DeviceDemoResultBody {
  final_decision: DeviceDemoFinalDecision;
  closing_notes?: string | null;
  closed_by_employee_id?: number | null;

  // offer_presented
  offers?: OfferInput[];

  // device_sold
  sold_device_model_id?: number;
  offer_type?: 'cash' | 'installment';
  offer_amount?: number;
  installment_months?: number | null;
  discount_percentage?: number | null;
  sale_reference_number?: string | null;

  // rescheduled
  expected_date?: string | null;
  expected_time?: string | null;

  // rescheduled + cancelled
  reason_code_id?: number | null;
}

export interface CascadeHints {
  /** Caller should create a contract for this accepted offer. */
  createContractFor?: {
    deviceModelId: number;
    offerType: 'cash' | 'installment';
    totalAmount: number;
    firstPaymentAmount?: number | null;
    installmentMonths?: number | null;
    discountPercentage?: number | null;
    closedByEmployeeId: number | null;
    saleReferenceNumber: string | null;
    /** customer_pre_offers.id when from offer_presented, NULL when from device_sold. */
    sourceCustomerPreOfferId: number | null;
  } | null;
}

export interface ReflectionResult {
  visitTaskResultId: number;
  deviceDemoResultId: number;
  openTaskNewStatus: string;
  openTaskExpectedDate: string | null;
  visitCompleted: boolean;
  cascadeHints: CascadeHints;
}

export interface DeviceDeliveryResultBody {
  final_decision: DeviceDeliveryFinalDecision;
  reason_code?: string | null;
  closing_notes?: string | null;
  serial_number?: string | null;
  device_model_id?: number | null;
  delivery_address?: string | null;
  delivery_geo_unit_id?: number | null;
  delivery_address_text?: string | null;
  actual_delivery_date?: string | null;
  delivered_by_employee_id?: number | null;
  customer_acknowledged?: boolean | null;
  delivery_condition?: 'perfect' | 'minor_damage' | 'missing_accessories' | null;
  delivery_photos?: unknown[] | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  notes?: string | null;
  expected_date?: string | null;
  expected_time?: string | null;
  after_delivery_action?: 'none' | 'create_installation_task' | null;
  installation_address_same_as_delivery?: boolean | null;
  installation_address?: string | null;
  installation_geo_unit_id?: number | null;
  installation_address_text?: string | null;
  installation_lat?: number | null;
  installation_lng?: number | null;
  installation_required_date?: string | null;
  update_device_main_address?: boolean | null;
  new_installation_geo_unit_id?: number | null;
  new_installation_address_text?: string | null;
  new_installation_lat?: number | null;
  new_installation_lng?: number | null;
}

export interface DeviceDeliveryReflectionResult {
  visitTaskResultId: number;
  deviceDeliveryResultId: number;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'delivered' | 'pending_delivery';
  createdInstallationTaskId: number | null;
  visitCompleted: boolean;
}

export interface DeviceInstallationPartInput {
  source: 'customer_stock' | 'company_stock' | 'external_or_manual';
  placement_state: 'installed' | 'customer_stock';
  spare_part_id?: number | null;
  part_name?: string | null;
  part_code?: string | null;
  maintenance_type?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  customer_stock_origin?: string | null;
  notes?: string | null;
}

export interface DeviceInstallationResultBody {
  final_decision: DeviceInstallationFinalDecision;
  closing_notes?: string | null;
  notes?: string | null;
  installation_incomplete_reason_id?: number | null;
  installation_refusal_reason_id?: number | null;
  expected_date?: string | null;
  activation_due_date?: string | null;
  final_installation_geo_unit_id?: number | null;
  final_installation_address_text?: string | null;
  final_installation_lat?: number | null;
  final_installation_lng?: number | null;
  customer_acknowledged?: boolean | null;
  receiver_name?: string | null;
  receiver_signature?: string | null;
  parts?: DeviceInstallationPartInput[] | null;
  installation_payment?: unknown;
}

export interface DeviceInstallationReflectionResult {
  visitTaskResultId: number;
  deviceInstallationResultId: number;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'installed' | 'delivered';
  createdActivationTaskId: number | null;
  visitCompleted: boolean;
}

export interface DeviceActivationResultBody {
  final_decision: DeviceActivationFinalDecision;
  closing_notes?: string | null;
  notes?: string | null;
  reason_code?: string | null;
  expected_date?: string | null;
  expected_time?: string | null;
  tds_before?: number | null;
  tds_after?: number | null;
  pump_pressure?: number | null;
  membrane_output?: string | null;
  tank_pressure?: number | null;
  uv_status?: string | null;
  customer_trained?: boolean | null;
  training_notes?: string | null;
  activation_photos?: unknown[] | null;
  activated_by_employee_id?: number | null;
}

export interface DeviceActivationReflectionResult {
  visitTaskResultId: number;
  deviceActivationResultId: number;
  openTaskNewStatus: 'completed' | 'needs_follow_up';
  deviceNewStatus: 'active' | 'installed';
  visitCompleted: boolean;
}

class ResultValidationError extends Error {
  status = 400;
  constructor(msg: string) {
    super(msg);
    this.name = 'ResultValidationError';
  }
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function isPositiveNumber(v: any): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isPositiveInteger(v: any): boolean {
  return Number.isInteger(Number(v)) && Number(v) > 0;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalDate(value: unknown): string | null {
  const text = optionalText(value);
  return text ? text.slice(0, 10) : null;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveEmployeeIdForUser(
  db: Pick<PoolClient, 'query'>,
  userId: number,
): Promise<number | null> {
  const { rows } = await db.query(
    'SELECT employee_id AS "employeeId" FROM hr_users WHERE id = $1',
    [userId],
  );
  const employeeId = Number(rows[0]?.employeeId);
  return Number.isInteger(employeeId) && employeeId > 0 ? employeeId : null;
}

function mapDeliveryReasonToPossessionReason(
  reason: string | null | undefined,
): 'sale_delivery' | 'temporary_swap' | 'transfer' {
  if (reason === 'sale_delivery') return 'sale_delivery';
  if (reason === 'temporary_swap_delivery') return 'temporary_swap';
  return 'transfer';
}

function assertDeliveryShape(body: DeviceDeliveryResultBody, openTask: any): {
  decision: DeviceDeliveryFinalDecision;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'delivered' | 'pending_delivery';
  deliveryAddress: string;
  afterDeliveryAction: 'none' | 'create_installation_task';
} {
  const decision = body.final_decision;
  if (!['delivered_successfully', 'customer_not_available', 'wrong_address', 'refused_delivery'].includes(decision)) {
    throw new ResultValidationError(`final_decision ط؛ظٹط± طµط§ظ„ط­: ${decision}`);
  }

  const deliveryAddressText = optionalText(body.delivery_address_text);
  const deliveryAddress =
    optionalText(body.delivery_address)
    ?? deliveryAddressText
    ?? optionalText(openTask.delivery_address);
  if (!deliveryAddress) {
    throw new ResultValidationError('delivery_address ظ…ط·ظ„ظˆط¨ ظ„ظ…ظ‡ظ…ط© طھط³ظ„ظٹظ… ط§ظ„ط¬ظ‡ط§ط²');
  }

  const afterDeliveryAction = body.after_delivery_action ?? 'none';
  if (!['none', 'create_installation_task'].includes(afterDeliveryAction)) {
    throw new ResultValidationError('after_delivery_action ط؛ظٹط± طµط§ظ„ط­');
  }
  if (decision !== 'delivered_successfully' && afterDeliveryAction !== 'none') {
    throw new ResultValidationError('after_delivery_action ظٹط³ظ…ط­ ظپظ‚ط· ط¹ظ†ط¯ delivered_successfully');
  }
  if (afterDeliveryAction === 'create_installation_task') {
    if (!optionalDate(body.installation_required_date)) {
      throw new ResultValidationError('installation_required_date ظ…ط·ظ„ظˆط¨ ط¹ظ†ط¯ ط¥ظ†ط´ط§ط، ظ…ظ‡ظ…ط© طھط±ظƒظٹط¨');
    }
    const sameAddress = body.installation_address_same_as_delivery === true;
    if (!sameAddress && !optionalText(body.installation_address) && !optionalText(body.installation_address_text)) {
      throw new ResultValidationError('installation_address ظ…ط·ظ„ظˆط¨ ط¥ط°ط§ ظƒط§ظ† ط¹ظ†ظˆط§ظ† ط§ظ„طھط±ظƒظٹط¨ ظ…ط®طھظ„ظپط§ظ‹');
    }
  }

  if (body.update_device_main_address === true) {
    if (openTask.reason !== 'post_maintenance_return') {
      throw new ResultValidationError('update_device_main_address ظ…ط³ظ…ظˆط­ ظپظ‚ط· ظ„ط³ط¨ط¨ post_maintenance_return');
    }
    if (decision !== 'delivered_successfully') {
      throw new ResultValidationError('update_device_main_address ظٹطھط·ظ„ط¨ طھط³ظ„ظٹظ…ط§ظ‹ ظ†ط§ط¬ط­ط§ظ‹');
    }
    if (!isPositiveInteger(body.new_installation_geo_unit_id) || !optionalText(body.new_installation_address_text)) {
      throw new ResultValidationError('ط¨ظٹط§ظ†ط§طھ ط¹ظ†ظˆط§ظ† ط§ظ„ط¬ظ‡ط§ط² ط§ظ„ط¬ط¯ظٹط¯ ط¥ظ„ط²ط§ظ…ظٹط©');
    }
  }

  if ((decision === 'customer_not_available' || decision === 'wrong_address') && !optionalDate(body.expected_date)) {
    throw new ResultValidationError('expected_date مطلوب عند إعادة المتابعة');
  }

  if (decision === 'delivered_successfully') {
    return {
      decision,
      openTaskNewStatus: 'completed',
      deviceNewStatus: 'delivered',
      deliveryAddress,
      afterDeliveryAction,
    };
  }
  if (decision === 'refused_delivery') {
    return {
      decision,
      openTaskNewStatus: 'cancelled',
      deviceNewStatus: 'pending_delivery',
      deliveryAddress,
      afterDeliveryAction,
    };
  }
  return {
    decision,
    openTaskNewStatus: 'needs_follow_up',
    deviceNewStatus: 'pending_delivery',
    deliveryAddress,
    afterDeliveryAction,
  };
}

function assertInstallationShape(body: DeviceInstallationResultBody): {
  decision: DeviceInstallationFinalDecision;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'installed' | 'delivered';
} {
  const decision = body.final_decision;
  if (!['installed_successfully', 'installation_incomplete', 'refused_installation'].includes(decision)) {
    throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
  }

  if (decision === 'installed_successfully') {
    if (!optionalDate(body.activation_due_date)) {
      throw new ResultValidationError('activation_due_date مطلوب عند نجاح التركيب');
    }
    if (!isPositiveInteger(body.final_installation_geo_unit_id) || !optionalText(body.final_installation_address_text)) {
      throw new ResultValidationError('موقع التركيب النهائي يتطلب منطقة وعنوانا تفصيليا');
    }
    if (body.customer_acknowledged !== true) {
      throw new ResultValidationError('إقرار الزبون مطلوب عند نجاح التركيب');
    }
    if (!optionalText(body.receiver_name)) {
      throw new ResultValidationError('اسم المستلم مطلوب عند نجاح التركيب');
    }
    if (!optionalText(body.receiver_signature)) {
      throw new ResultValidationError('توقيع المستلم مطلوب عند نجاح التركيب');
    }
    return { decision, openTaskNewStatus: 'completed', deviceNewStatus: 'installed' };
  }

  if (decision === 'installation_incomplete') {
    if (!isPositiveInteger(body.installation_incomplete_reason_id)) {
      throw new ResultValidationError('سبب عدم اكتمال التركيب مطلوب');
    }
    if (!optionalDate(body.expected_date)) {
      throw new ResultValidationError('expected_date مطلوب عند عدم اكتمال التركيب');
    }
    return { decision, openTaskNewStatus: 'needs_follow_up', deviceNewStatus: 'delivered' };
  }

  if (!isPositiveInteger(body.installation_refusal_reason_id)) {
    throw new ResultValidationError('سبب رفض التركيب مطلوب');
  }
  return { decision, openTaskNewStatus: 'cancelled', deviceNewStatus: 'delivered' };
}

function assertActivationShape(body: DeviceActivationResultBody): {
  decision: DeviceActivationFinalDecision;
  openTaskNewStatus: 'completed' | 'needs_follow_up';
  deviceNewStatus: 'active' | 'installed';
} {
  const decision = body.final_decision;
  if (!['activated_successfully', 'activation_failed', 'device_issue'].includes(decision)) {
    throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
  }

  if (decision === 'activated_successfully') {
    if (body.customer_trained !== true) {
      throw new ResultValidationError('تأكيد تدريب الزبون مطلوب عند نجاح التشغيل');
    }
    return { decision, openTaskNewStatus: 'completed', deviceNewStatus: 'active' };
  }

  if (!optionalDate(body.expected_date)) {
    throw new ResultValidationError('تاريخ المتابعة مطلوب عند فشل التشغيل أو وجود مشكلة بالجهاز');
  }
  return { decision, openTaskNewStatus: 'needs_follow_up', deviceNewStatus: 'installed' };
}

function normalizeInstallationParts(parts: unknown): DeviceInstallationPartInput[] {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((raw: any) => ({
      source: raw?.source,
      placement_state: raw?.placement_state ?? 'installed',
      spare_part_id: isPositiveInteger(raw?.spare_part_id) ? Number(raw.spare_part_id) : null,
      part_name: optionalText(raw?.part_name),
      part_code: optionalText(raw?.part_code),
      maintenance_type: optionalText(raw?.maintenance_type),
      quantity: Number(raw?.quantity) > 0 ? Number(raw.quantity) : 1,
      unit_price: optionalNumber(raw?.unit_price),
      customer_stock_origin: optionalText(raw?.customer_stock_origin),
      notes: optionalText(raw?.notes),
    }))
    .filter((part) => (
      ['customer_stock', 'company_stock', 'external_or_manual'].includes(String(part.source))
      && ['installed', 'customer_stock'].includes(String(part.placement_state))
      && (!!part.spare_part_id || !!part.part_name)
    )) as DeviceInstallationPartInput[];
}

function normalizeInstallationPayment(payment: unknown): Record<string, unknown> {
  if (!payment || typeof payment !== 'object') return {};
  const raw = payment as any;
  const entries = Array.isArray(raw.payment_entries) ? raw.payment_entries : [];
  const paymentEntries = entries
    .map((entry: any) => ({
      method: optionalText(entry?.method),
      amount_value: optionalNumber(entry?.amount_value),
      currency: optionalText(entry?.currency) || 'syp',
      exchange_rate: optionalNumber(entry?.exchange_rate),
      transfer_company_id: isPositiveInteger(entry?.transfer_company_id) ? Number(entry.transfer_company_id) : null,
      barter_description: optionalText(entry?.barter_description),
      amount_syp: optionalNumber(entry?.amount_syp),
    }))
    .filter((entry) => entry.method && (entry.amount_value ?? 0) > 0);

  return {
    payment_type: optionalText(raw.payment_type),
    invoice_notes: optionalText(raw.invoice_notes),
    total_parts_amount: optionalNumber(raw.total_parts_amount) ?? 0,
    total_paid_syp: optionalNumber(raw.total_paid_syp) ?? 0,
    payment_entries: paymentEntries,
  };
}

function assertOfferShape(o: OfferInput, idx: number): void {
  if (!isPositiveNumber(o.device_model_id)) throw new ResultValidationError(`العرض #${idx + 1}: device_model_id غير صالح`);
  if (o.offer_type !== 'cash' && o.offer_type !== 'installment') throw new ResultValidationError(`العرض #${idx + 1}: offer_type يجب أن يكون cash أو installment`);
  if (!isPositiveNumber(o.quantity)) throw new ResultValidationError(`العرض #${idx + 1}: quantity يجب أن يكون > 0`);
  if (!isPositiveNumber(o.total_amount)) throw new ResultValidationError(`العرض #${idx + 1}: total_amount يجب أن يكون > 0`);
  if (typeof o.currency !== 'string' || !o.currency.trim()) throw new ResultValidationError(`العرض #${idx + 1}: currency مطلوب`);
  if (!['accepted', 'rejected', 'extension_requested'].includes(o.customer_response)) {
    throw new ResultValidationError(`العرض #${idx + 1}: customer_response غير صالح`);
  }
  if (o.offer_type === 'installment') {
    if (!isPositiveNumber(o.installment_months)) throw new ResultValidationError(`العرض #${idx + 1}: installment_months مطلوب للتقسيط`);
  }
  if (o.customer_response === 'rejected' && !(typeof o.no_closing_reason === 'string' && o.no_closing_reason.trim())) {
    throw new ResultValidationError(`العرض #${idx + 1}: سبب الرفض مطلوب`);
  }
  if (
    !isPositiveNumber(o.closed_by_employee_id)
    && !(typeof o.no_closing_reason === 'string' && o.no_closing_reason.trim())
  ) {
    throw new ResultValidationError(`Offer #${idx + 1}: closed_by_employee_id or no_closing_reason is required`);
  }
}

function normalizeSaleReference(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized.slice(0, 32) : null;
}

function generateSaleReferenceNumber(): string {
  const compact = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `S${compact}${suffix}`;
}

function deriveReflectionForOfferPresented(offers: OfferInput[]): {
  openTaskNewStatus: 'completed' | 'needs_follow_up';
  acceptedCount: number;
  extensionCount: number;
} {
  const acceptedCount = offers.filter(o => o.customer_response === 'accepted').length;
  const extensionCount = offers.filter(o => o.customer_response === 'extension_requested').length;
  if (acceptedCount > 0) return { openTaskNewStatus: 'completed', acceptedCount, extensionCount };
  if (extensionCount > 0) return { openTaskNewStatus: 'needs_follow_up', acceptedCount, extensionCount };
  // All rejected → the task fulfilled its purpose (offer was made and refused).
  return { openTaskNewStatus: 'completed', acceptedCount, extensionCount };
}

// ────────────────────────────────────────────────────────────
// Main entry
// ────────────────────────────────────────────────────────────

export async function applyDeviceDemoResult(
  visitTaskId: number,
  body: DeviceDemoResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<ReflectionResult> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();

  try {
    if (!useExternal) await db.query('BEGIN');

    // ── 1. Load and validate ───────────────────────────────────
    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status, fv.client_id, fv.branch_id
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
        WHERE vt.id = $1 LIMIT 1`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير موجود');

    const vt = vtRows[0];
    if (vt.task_type !== 'device_demo') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" — هذا الـ service لـ device_demo فقط`);
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة — الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`المهمة في حالة "${vt.status}" ولا تقبل تسجيل نتيجة جديدة`);
    }

    const decision = body.final_decision;
    if (!['offer_presented', 'device_sold', 'rescheduled', 'cancelled'].includes(decision)) {
      throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
    }

    // ── 2. Decision-specific validation ────────────────────────
    let openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled' = 'completed';
    let openTaskExpectedDate: string | null = null;
    let cascadeHints: CascadeHints = { createContractFor: null };

    if (decision === 'offer_presented') {
      if (!Array.isArray(body.offers) || body.offers.length === 0) {
        throw new ResultValidationError('offers مطلوبة عند offer_presented');
      }
      body.offers.forEach(assertOfferShape);
      if (false && body.offers.some(o => o.customer_response === 'accepted') && !isPositiveNumber(body.closed_by_employee_id)) {
        throw new ResultValidationError('closed_by_employee_id مطلوب');
      }

      const reflection = deriveReflectionForOfferPresented(body.offers);
      openTaskNewStatus = reflection.openTaskNewStatus;

      if (openTaskNewStatus === 'needs_follow_up') {
        openTaskExpectedDate = body.expected_date ?? null;
      }
    } else if (decision === 'device_sold') {
      if (!isPositiveNumber(body.sold_device_model_id)) throw new ResultValidationError('sold_device_model_id مطلوب');
      if (body.offer_type !== 'cash' && body.offer_type !== 'installment') throw new ResultValidationError('offer_type غير صالح');
      if (!isPositiveNumber(body.offer_amount)) throw new ResultValidationError('offer_amount مطلوب');
      if (!isPositiveNumber(body.closed_by_employee_id)) throw new ResultValidationError('closed_by_employee_id مطلوب');
      if (body.offer_type === 'installment' && !isPositiveNumber(body.installment_months)) {
        throw new ResultValidationError('installment_months مطلوب للتقسيط');
      }
      openTaskNewStatus = 'completed';
    } else if (decision === 'rescheduled') {
      if (!isPositiveNumber(body.reason_code_id)) throw new ResultValidationError('reason_code_id مطلوب');
      if (!body.expected_date) throw new ResultValidationError('expected_date مطلوب');
      openTaskNewStatus = 'needs_follow_up';
      openTaskExpectedDate = body.expected_date;
    } else if (decision === 'cancelled') {
      if (!isPositiveNumber(body.reason_code_id)) throw new ResultValidationError('reason_code_id مطلوب');
      openTaskNewStatus = 'cancelled';
    }

    // ── 3. Insert visit_task_results ───────────────────────────
    const { rows: vtrRows } = await db.query(
      `INSERT INTO visit_task_results
         (visit_task_id, final_decision, reason_code, closing_notes, closed_by, closed_at, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, $4, NOW(), NOW(), NOW())
       ON CONFLICT (visit_task_id) DO UPDATE SET
         final_decision = EXCLUDED.final_decision,
         closing_notes  = EXCLUDED.closing_notes,
         closed_by      = EXCLUDED.closed_by,
         closed_at      = NOW(),
         updated_at     = NOW()
       RETURNING id`,
      [visitTaskId, decision, body.closing_notes ?? null, performedByUserId],
    );
    const visitTaskResultId: number = vtrRows[0].id;

    // ── 4. Insert visit_task_device_demo_results (side table) ──
    const isDeviceSold = decision === 'device_sold' ||
      (decision === 'offer_presented' && (body.offers ?? []).some(o => o.customer_response === 'accepted'));
    const firstAcceptedOffer = decision === 'offer_presented'
      ? (body.offers ?? []).find(o => o.customer_response === 'accepted') ?? null
      : null;
    const deviceSoldSaleReference = isDeviceSold
      ? (
          decision === 'device_sold'
            ? normalizeSaleReference(body.sale_reference_number) ?? generateSaleReferenceNumber()
            : normalizeSaleReference(firstAcceptedOffer?.sale_reference_number) ?? generateSaleReferenceNumber()
        )
      : null;
    if (firstAcceptedOffer) {
      firstAcceptedOffer.sale_reference_number = deviceSoldSaleReference;
    }

    const { rows: vtdrRows } = await db.query(
      `INSERT INTO visit_task_device_demo_results
         (visit_task_result_id,
          offer_type, offer_amount, installment_months,
          closed_by_employee_id, contract_id,
          discount_percentage, sale_reference_number,
          is_device_sold, offered_device_model_id,
          reason_code_id, closing_notes,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,NOW(),NOW())
       ON CONFLICT (visit_task_result_id) DO UPDATE SET
          offer_type = EXCLUDED.offer_type,
          offer_amount = EXCLUDED.offer_amount,
          installment_months = EXCLUDED.installment_months,
          closed_by_employee_id = EXCLUDED.closed_by_employee_id,
          discount_percentage = EXCLUDED.discount_percentage,
          sale_reference_number = EXCLUDED.sale_reference_number,
          is_device_sold = EXCLUDED.is_device_sold,
          offered_device_model_id = EXCLUDED.offered_device_model_id,
          reason_code_id = EXCLUDED.reason_code_id,
          closing_notes = EXCLUDED.closing_notes,
          updated_at = NOW()
       RETURNING id`,
      [
        visitTaskResultId,
        decision === 'device_sold' ? body.offer_type : null,
        decision === 'device_sold' ? body.offer_amount : null,
        decision === 'device_sold' ? (body.installment_months ?? null) : null,
        body.closed_by_employee_id ?? null,
        decision === 'device_sold' ? (body.discount_percentage ?? null) : null,
        deviceSoldSaleReference,
        isDeviceSold,
        decision === 'device_sold' ? body.sold_device_model_id : firstAcceptedOffer?.device_model_id ?? null,
        body.reason_code_id ?? null,
        body.closing_notes ?? null,
      ],
    );
    const deviceDemoResultId: number = vtdrRows[0].id;

    // ── 5. Insert per-offer rows for offer_presented ───────────
    let acceptedPreOfferId: number | null = null;
    let acceptedOfferData: OfferInput | null = null;

    if (decision === 'offer_presented') {
      // Linked standalone offers keep their identity: result recording updates
      // customer_device_pre_offers instead of creating a duplicate history row.
      for (const offer of body.offers!) {
        let sourceCustomerPreOfferId = isPositiveNumber(offer.source_customer_pre_offer_id)
          ? Number(offer.source_customer_pre_offer_id)
          : null;
        const openTaskPreOfferId = isPositiveNumber(offer.open_task_pre_offer_id)
          ? Number(offer.open_task_pre_offer_id)
          : null;

        // When the offer came from an existing task row but no longer carries
        // a source_customer_pre_offer_id (e.g. authored manually pre-migration),
        // we still need to UPDATE the row instead of inserting a duplicate.
        // Recover the CDPO link, if any, from the existing row so the CDPO
        // UPDATE path below can hit its target as well.
        if (openTaskPreOfferId != null && sourceCustomerPreOfferId == null && vt.source_open_task_id) {
          const { rows: existingRows } = await db.query(
            `SELECT source_customer_pre_offer_id AS "cdpoId"
               FROM open_task_pre_offers
              WHERE id = $1
                AND open_task_id = $2
              LIMIT 1`,
            [openTaskPreOfferId, vt.source_open_task_id],
          );
          if (existingRows.length > 0 && isPositiveNumber(existingRows[0].cdpoId)) {
            sourceCustomerPreOfferId = Number(existingRows[0].cdpoId);
          }
        }
        const offerCloserId = offer.closed_by_employee_id ?? body.closed_by_employee_id ?? null;
        const offerNoClosingReason = typeof offer.no_closing_reason === 'string'
          ? offer.no_closing_reason.trim() || null
          : null;
        const offerSaleReference = offer.customer_response === 'accepted'
          ? normalizeSaleReference(offer.sale_reference_number) ?? generateSaleReferenceNumber()
          : null;
        if (offer.customer_response === 'accepted') {
          offer.sale_reference_number = offerSaleReference;
        }

        let cdpoId: number | null = null;
        if (sourceCustomerPreOfferId != null) {
          const { rows: updatedRows } = await db.query(
            `UPDATE customer_device_pre_offers
                SET branch_id = $2,
                    device_model_id = $3,
                    offer_type = $4,
                    quantity = $5,
                    total_amount = $6,
                    first_payment_amount = $7,
                    installment_months = $8,
                    currency = $9,
                    discount_percentage = $10,
                    applied_device_discount_id = $11,
                    closed_by_employee_id = $12,
                    no_closing_reason = $13,
                    response_state = $14,
                    response_notes = COALESCE($15, response_notes),
                    sale_reference_number = $16,
                    updated_at = NOW()
              WHERE id = $1
                AND customer_id = $17
              RETURNING id`,
            [
              sourceCustomerPreOfferId,
              vt.branch_id,
              offer.device_model_id,
              offer.offer_type,
              offer.quantity,
              offer.total_amount,
              offer.first_payment_amount ?? null,
              offer.installment_months ?? null,
              offer.currency,
              offer.discount_percentage ?? null,
              offer.applied_device_discount_id ?? null,
              offerCloserId,
              offerNoClosingReason,
              offer.customer_response,
              body.closing_notes ?? null,
              offerSaleReference,
              vt.client_id,
            ],
          );
          cdpoId = updatedRows.length > 0 ? Number(updatedRows[0].id) : null;
        }

        if (cdpoId == null) {
          const { rows: cdpoRows } = await db.query(
            `INSERT INTO customer_device_pre_offers
               (customer_id, branch_id, device_model_id, offer_type, quantity,
                total_amount, first_payment_amount, installment_months, currency,
                discount_percentage, applied_device_discount_id,
                closed_by_employee_id, no_closing_reason, response_state,
                response_notes, sale_reference_number, created_by, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
             RETURNING id`,
            [
              vt.client_id,
              vt.branch_id,
              offer.device_model_id,
              offer.offer_type,
              offer.quantity,
              offer.total_amount,
              offer.first_payment_amount ?? null,
              offer.installment_months ?? null,
              offer.currency,
              offer.discount_percentage ?? null,
              offer.applied_device_discount_id ?? null,
              offerCloserId,
              offerNoClosingReason,
              offer.customer_response,
              body.closing_notes ?? null,
              offerSaleReference,
              performedByUserId,
            ],
          );
          cdpoId = Number(cdpoRows[0].id);
        }

        if (vt.source_open_task_id) {
          const openTaskOfferValues = [
            vt.source_open_task_id,
            offer.device_model_id,
            offer.offer_type,
            offer.quantity,
            offer.total_amount,
            offer.first_payment_amount ?? null,
            offer.installment_months ?? null,
            offer.currency,
            offer.discount_percentage ?? null,
            offer.applied_device_discount_id ?? null,
            offerCloserId,
            offerNoClosingReason,
            cdpoId,
            offerSaleReference,
          ];

          // Preferred path: update by primary key when the client echoed back
          // the original open_task_pre_offers.id. This works regardless of
          // whether source_customer_pre_offer_id was populated on the row.
          let updated = false;
          if (openTaskPreOfferId != null) {
            const { rowCount } = await db.query(
              `UPDATE open_task_pre_offers
                  SET device_model_id = $2,
                      offer_type = $3,
                      quantity = $4,
                      total_amount = $5,
                      first_payment_amount = $6,
                      installment_months = $7,
                      currency = $8,
                      discount_percentage = $9,
                      applied_device_discount_id = $10,
                      closed_by_employee_id = $11,
                      no_closing_reason = $12,
                      source_customer_pre_offer_id = $13,
                      sale_reference_number = $14,
                      updated_at = NOW()
                WHERE id = $15
                  AND open_task_id = $1`,
              [...openTaskOfferValues, openTaskPreOfferId],
            );
            updated = (rowCount ?? 0) > 0;
          }

          // Fallback: legacy path keyed on source_customer_pre_offer_id. This
          // remains correct for offers imported from a standalone CDPO where
          // the row was created with that link already in place.
          if (!updated && sourceCustomerPreOfferId != null) {
            const { rowCount } = await db.query(
              `UPDATE open_task_pre_offers
                  SET device_model_id = $2,
                      offer_type = $3,
                      quantity = $4,
                      total_amount = $5,
                      first_payment_amount = $6,
                      installment_months = $7,
                      currency = $8,
                      discount_percentage = $9,
                      applied_device_discount_id = $10,
                      closed_by_employee_id = $11,
                      no_closing_reason = $12,
                      source_customer_pre_offer_id = $13,
                      sale_reference_number = $14,
                      updated_at = NOW()
                WHERE open_task_id = $1
                  AND source_customer_pre_offer_id = $13`,
              openTaskOfferValues,
            );
            updated = (rowCount ?? 0) > 0;
          }

          if (updated) {
            if (offer.customer_response === 'accepted' && acceptedPreOfferId == null) {
              acceptedPreOfferId = cdpoId;
              acceptedOfferData = offer;
            }
            continue;
          }

          await db.query(
            `INSERT INTO open_task_pre_offers
               (open_task_id, device_model_id, offer_type, quantity,
                total_amount, first_payment_amount, installment_months, currency,
                discount_percentage, applied_device_discount_id,
                closed_by_employee_id, no_closing_reason,
                source_customer_pre_offer_id, sale_reference_number, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())`,
            openTaskOfferValues,
          );
        }

        if (offer.customer_response === 'accepted' && acceptedPreOfferId == null) {
          acceptedPreOfferId = cdpoId;
          acceptedOfferData = offer;
        }
      }
    }

    // ── 6. Update visit_tasks.status ───────────────────────────
    const newVtStatus = decision === 'cancelled' ? 'cancelled' : 'completed';
    await db.query(
      `UPDATE visit_tasks SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newVtStatus, visitTaskId],
    );

    // ── 7. Reflect onto open_task ──────────────────────────────
    if (vt.source_open_task_id) {
      if (openTaskNewStatus === 'cancelled') {
        await db.query(
          `UPDATE open_tasks
              SET status = 'cancelled',
                  cancellation_reason = COALESCE($2, cancellation_reason),
                  updated_at = NOW()
            WHERE id = $1`,
          [vt.source_open_task_id, body.closing_notes ?? null],
        );
      } else if (openTaskNewStatus === 'needs_follow_up') {
        // Save last_waiting_status if currently in an active phase, then move back.
        await db.query(
          `UPDATE open_tasks
              SET last_waiting_status = CASE
                    WHEN status IN ('open', 'needs_follow_up') THEN status
                    ELSE COALESCE(last_waiting_status, 'open')
                  END,
                  status = 'needs_follow_up',
                  expected_date = COALESCE($2::date, expected_date),
                  expected_time = COALESCE($3, expected_time),
                  updated_at = NOW()
            WHERE id = $1`,
          [vt.source_open_task_id, openTaskExpectedDate, body.expected_time ?? null],
        );
      } else { // 'completed'
        await db.query(
          `UPDATE open_tasks
              SET last_waiting_status = CASE
                    WHEN status IN ('open', 'needs_follow_up') THEN status
                    ELSE last_waiting_status
                  END,
                  status = 'completed',
                  updated_at = NOW()
            WHERE id = $1`,
          [vt.source_open_task_id],
        );
      }
    }

    // ── 8. Cascade hints (contract + delivery chain) ───────────
    if (decision === 'device_sold') {
      cascadeHints.createContractFor = {
        deviceModelId:           body.sold_device_model_id!,
        offerType:               body.offer_type!,
        totalAmount:             body.offer_amount!,
        firstPaymentAmount:      null,
        installmentMonths:       body.installment_months ?? null,
        discountPercentage:      body.discount_percentage ?? null,
        closedByEmployeeId:      body.closed_by_employee_id ?? null,
        saleReferenceNumber:     deviceSoldSaleReference,
        sourceCustomerPreOfferId: null,
      };
    } else if (decision === 'offer_presented' && acceptedOfferData) {
      cascadeHints.createContractFor = {
        deviceModelId:           acceptedOfferData.device_model_id,
        offerType:               acceptedOfferData.offer_type,
        totalAmount:             acceptedOfferData.total_amount,
        firstPaymentAmount:      acceptedOfferData.first_payment_amount ?? null,
        installmentMonths:       acceptedOfferData.installment_months ?? null,
        discountPercentage:      acceptedOfferData.discount_percentage ?? null,
        closedByEmployeeId:      acceptedOfferData.closed_by_employee_id ?? body.closed_by_employee_id ?? null,
        saleReferenceNumber:     normalizeSaleReference(acceptedOfferData.sale_reference_number),
        sourceCustomerPreOfferId: acceptedPreOfferId,
      };
    }

    // ── 9. Auto-advance the visit if its guards pass ───────────
    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);

    if (!useExternal) await db.query('COMMIT');

    return {
      visitTaskResultId,
      deviceDemoResultId,
      openTaskNewStatus,
      openTaskExpectedDate,
      visitCompleted: completion.completed,
      cascadeHints,
    };
  } catch (err) {
    if (!useExternal) await db.query('ROLLBACK');
    throw err;
  } finally {
    if (!useExternal) (db as PoolClient).release();
  }
}

export async function applyDeviceDeliveryResult(
  visitTaskId: number,
  body: DeviceDeliveryResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<DeviceDeliveryReflectionResult> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();

  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status, fv.scheduled_date AS visit_date, fv.client_id, fv.branch_id,
              ot.id AS open_task_id, ot.contract_id, ot.device_id, ot.reason,
              ot.delivery_address, ot.priority, ot.notes
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         JOIN open_tasks ot ON ot.id = vt.source_open_task_id
        WHERE vt.id = $1
        LIMIT 1`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task ط؛ظٹط± ظ…ط±ط¨ظˆط· ط¨ظ…ظ‡ظ…ط© ظ…ظپطھظˆط­ط©');

    const vt = vtRows[0];
    if (vt.task_type !== 'device_delivery') {
      throw new ResultValidationError(`ظ†ظˆط¹ ط§ظ„ظ…ظ‡ظ…ط© "${vt.task_type}" â€” ظ‡ط°ط§ ط§ظ„ظ€ service ظ„ظ€ device_delivery ظپظ‚ط·`);
    }
    if (!isPositiveInteger(vt.device_id)) {
      throw new ResultValidationError('device_delivery ظٹط¬ط¨ ط£ظ† طھط±طھط¨ط· ط¨ظ€ installed_device');
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`ظ„ط§ ظٹظ…ظƒظ† طھط³ط¬ظٹظ„ ط§ظ„ظ†طھظٹط¬ط© â€” ط§ظ„ط²ظٹط§ط±ط© ظپظٹ ط­ط§ظ„ط© "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`ط§ظ„ظ…ظ‡ظ…ط© ظپظٹ ط­ط§ظ„ط© "${vt.status}" ظˆظ„ط§ طھظ‚ط¨ظ„ طھط³ط¬ظٹظ„ ظ†طھظٹط¬ط© ط¬ط¯ظٹط¯ط©`);
    }

    const shape = assertDeliveryShape(body, vt);

    const { rows: vtrRows } = await db.query(
      `INSERT INTO visit_task_results
         (visit_task_id, final_decision, reason_code, closing_notes, closed_by, closed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
       ON CONFLICT (visit_task_id) DO UPDATE SET
         final_decision = EXCLUDED.final_decision,
         reason_code    = EXCLUDED.reason_code,
         closing_notes  = EXCLUDED.closing_notes,
         closed_by      = EXCLUDED.closed_by,
         closed_at      = NOW(),
         updated_at     = NOW()
       RETURNING id`,
      [
        visitTaskId,
        shape.decision,
        optionalText(body.reason_code),
        body.closing_notes ?? body.notes ?? null,
        performedByUserId,
      ],
    );
    const visitTaskResultId = Number(vtrRows[0].id);

    const { rows: deliveryRows } = await db.query(
      `INSERT INTO visit_task_device_delivery_results
         (visit_task_result_id, serial_number, device_model_id, delivery_address,
          delivery_geo_unit_id, delivery_address_text,
          actual_delivery_date, delivered_by_employee_id, customer_acknowledged,
          delivery_photos, delivery_condition, outcome, delivery_lat, delivery_lng,
          notes, after_delivery_action, installation_address_same_as_delivery,
          installation_address, installation_geo_unit_id, installation_address_text,
          installation_lat, installation_lng,
          installation_required_date, update_device_main_address,
          new_installation_geo_unit_id, new_installation_address_text,
          new_installation_lat, new_installation_lng, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::date,$24,$25,$26,$27,$28,NOW(),NOW())
       ON CONFLICT (visit_task_result_id) DO UPDATE SET
          serial_number = EXCLUDED.serial_number,
          device_model_id = EXCLUDED.device_model_id,
          delivery_address = EXCLUDED.delivery_address,
          delivery_geo_unit_id = EXCLUDED.delivery_geo_unit_id,
          delivery_address_text = EXCLUDED.delivery_address_text,
          actual_delivery_date = EXCLUDED.actual_delivery_date,
          delivered_by_employee_id = EXCLUDED.delivered_by_employee_id,
          customer_acknowledged = EXCLUDED.customer_acknowledged,
          delivery_photos = EXCLUDED.delivery_photos,
          delivery_condition = EXCLUDED.delivery_condition,
          outcome = EXCLUDED.outcome,
          delivery_lat = EXCLUDED.delivery_lat,
          delivery_lng = EXCLUDED.delivery_lng,
          notes = EXCLUDED.notes,
          after_delivery_action = EXCLUDED.after_delivery_action,
          installation_address_same_as_delivery = EXCLUDED.installation_address_same_as_delivery,
          installation_address = EXCLUDED.installation_address,
          installation_geo_unit_id = EXCLUDED.installation_geo_unit_id,
          installation_address_text = EXCLUDED.installation_address_text,
          installation_lat = EXCLUDED.installation_lat,
          installation_lng = EXCLUDED.installation_lng,
          installation_required_date = EXCLUDED.installation_required_date,
          update_device_main_address = EXCLUDED.update_device_main_address,
          new_installation_geo_unit_id = EXCLUDED.new_installation_geo_unit_id,
          new_installation_address_text = EXCLUDED.new_installation_address_text,
          new_installation_lat = EXCLUDED.new_installation_lat,
          new_installation_lng = EXCLUDED.new_installation_lng,
          updated_at = NOW()
       RETURNING id`,
      [
        visitTaskResultId,
        optionalText(body.serial_number),
        isPositiveInteger(body.device_model_id) ? Number(body.device_model_id) : null,
        shape.deliveryAddress,
        isPositiveInteger(body.delivery_geo_unit_id) ? Number(body.delivery_geo_unit_id) : null,
        optionalText(body.delivery_address_text),
        optionalDate(body.actual_delivery_date) ?? optionalDate(vt.visit_date) ?? new Date().toISOString().slice(0, 10),
        isPositiveInteger(body.delivered_by_employee_id) ? Number(body.delivered_by_employee_id) : null,
        body.customer_acknowledged === true,
        JSON.stringify(Array.isArray(body.delivery_photos) ? body.delivery_photos : []),
        body.delivery_condition ?? null,
        shape.decision,
        optionalNumber(body.delivery_lat),
        optionalNumber(body.delivery_lng),
        body.notes ?? body.closing_notes ?? null,
        shape.afterDeliveryAction,
        body.installation_address_same_as_delivery ?? null,
        optionalText(body.installation_address),
        isPositiveInteger(body.installation_geo_unit_id) ? Number(body.installation_geo_unit_id) : null,
        optionalText(body.installation_address_text),
        optionalNumber(body.installation_lat),
        optionalNumber(body.installation_lng),
        optionalDate(body.installation_required_date),
        body.update_device_main_address === true,
        isPositiveInteger(body.new_installation_geo_unit_id) ? Number(body.new_installation_geo_unit_id) : null,
        optionalText(body.new_installation_address_text),
        optionalNumber(body.new_installation_lat),
        optionalNumber(body.new_installation_lng),
      ],
    );
    const deviceDeliveryResultId = Number(deliveryRows[0].id);

    await db.query(
      `UPDATE visit_tasks
          SET status = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [shape.openTaskNewStatus === 'cancelled' ? 'cancelled' : 'completed', visitTaskId],
    );

    if (shape.openTaskNewStatus === 'cancelled') {
      await db.query(
        `UPDATE open_tasks
            SET status = 'cancelled',
                cancellation_reason = COALESCE($2, cancellation_reason),
                updated_at = NOW()
          WHERE id = $1`,
        [vt.open_task_id, body.closing_notes ?? body.notes ?? 'refused_delivery'],
      );
    } else if (shape.openTaskNewStatus === 'needs_follow_up') {
      await db.query(
        `UPDATE open_tasks
            SET last_waiting_status = CASE
                  WHEN status IN ('open', 'needs_follow_up') THEN status
                  ELSE COALESCE(last_waiting_status, 'open')
                END,
                status = 'needs_follow_up',
                expected_date = COALESCE($2::date, expected_date),
                expected_time = COALESCE($3, expected_time),
                updated_at = NOW()
          WHERE id = $1`,
        [vt.open_task_id, optionalDate(body.expected_date), body.expected_time ?? null],
      );
    } else {
      await db.query(
        `UPDATE open_tasks
            SET last_waiting_status = CASE
                  WHEN status IN ('open', 'needs_follow_up') THEN status
                  ELSE last_waiting_status
                END,
                status = 'completed',
                updated_at = NOW()
          WHERE id = $1`,
        [vt.open_task_id],
      );
    }

    await db.query(
      `UPDATE installed_devices
          SET status = $1::varchar,
              delivery_date = CASE WHEN $4::boolean THEN COALESCE($3::date, delivery_date) ELSE delivery_date END,
              updated_at = NOW()
        WHERE id = $2::int`,
      [
        shape.deviceNewStatus,
        Number(vt.device_id),
        optionalDate(body.actual_delivery_date) ?? optionalDate(vt.visit_date),
        shape.deviceNewStatus === 'delivered',
      ],
    );

    if (shape.deviceNewStatus === 'delivered') {
      const { rows: customerRows } = await db.query(
        'SELECT customer_id FROM installed_devices WHERE id = $1',
        [Number(vt.device_id)],
      );
      const customerId = customerRows[0]?.customer_id ?? null;
      if (customerId) {
        const possessionReason = mapDeliveryReasonToPossessionReason(vt.reason ?? null);
        await db.query(
          `UPDATE device_possession_log
              SET end_at = NOW()
            WHERE device_id = $1 AND end_at IS NULL`,
          [Number(vt.device_id)],
        );
        await db.query(
          `INSERT INTO device_possession_log
             (device_id, holder_type, holder_id, reason, notes)
           VALUES ($1, 'customer', $2, $3,
                   'Logged automatically from canonical device_delivery result')`,
          [Number(vt.device_id), customerId, possessionReason],
        );
      }
    }

    if (body.update_device_main_address === true) {
      await db.query(
        `UPDATE installed_devices
            SET installation_geo_unit_id = $2,
                installation_address_text = $3,
                installation_lat = $4,
                installation_lng = $5,
                updated_at = NOW()
          WHERE id = $1`,
        [
          Number(vt.device_id),
          Number(body.new_installation_geo_unit_id),
          optionalText(body.new_installation_address_text),
          optionalNumber(body.new_installation_lat),
          optionalNumber(body.new_installation_lng),
        ],
      );
    }

    if (
      shape.afterDeliveryAction === 'create_installation_task'
      && isPositiveInteger(body.installation_geo_unit_id)
      && optionalText(body.installation_address_text)
    ) {
      await db.query(
        `UPDATE installed_devices
            SET installation_geo_unit_id = $2,
                installation_address_text = $3,
                installation_lat = $4,
                installation_lng = $5,
                updated_at = NOW()
          WHERE id = $1`,
        [
          Number(vt.device_id),
          Number(body.installation_geo_unit_id),
          optionalText(body.installation_address_text),
          optionalNumber(body.installation_lat),
          optionalNumber(body.installation_lng),
        ],
      );
    }

    let createdInstallationTaskId: number | null = null;
    if (shape.afterDeliveryAction === 'create_installation_task') {
      const installationAddress = body.installation_address_same_as_delivery === true
        ? shape.deliveryAddress
        : (optionalText(body.installation_address) ?? optionalText(body.installation_address_text));
      const { rows: installRows } = await db.query(
        `INSERT INTO open_tasks (
           client_id, branch_id, task_type, task_family, reason, status,
           due_date, priority, source, notes, created_by, origin,
           contract_id, device_id, creation_origin, delivery_address,
           source_context_type, source_context_id
         ) VALUES ($1, $2, 'device_installation', 'delivery', 'service_request', 'open',
           $3::date, $4, 'system', $5, $6, 'device_delivery_result',
           $7, $8, 'cascading_during_visit', $9, 'device_delivery', $10)
         RETURNING id`,
        [
          Number(vt.client_id),
          Number(vt.branch_id),
          optionalDate(body.installation_required_date),
          vt.priority ?? null,
          'Created from device_delivery after_delivery_action=create_installation_task',
          performedByUserId,
          vt.contract_id ?? null,
          Number(vt.device_id),
          installationAddress,
          Number(vt.open_task_id),
        ],
      );
      createdInstallationTaskId = Number(installRows[0].id);
    }

    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);

    if (!useExternal) await db.query('COMMIT');

    return {
      visitTaskResultId,
      deviceDeliveryResultId,
      openTaskNewStatus: shape.openTaskNewStatus,
      deviceNewStatus: shape.deviceNewStatus,
      createdInstallationTaskId,
      visitCompleted: completion.completed,
    };
  } catch (err) {
    if (!useExternal) await db.query('ROLLBACK');
    throw err;
  } finally {
    if (!useExternal) (db as PoolClient).release();
  }
}

export async function applyDeviceInstallationResult(
  visitTaskId: number,
  body: DeviceInstallationResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<DeviceInstallationReflectionResult> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();

  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status, fv.scheduled_date AS visit_date, fv.client_id, fv.branch_id,
              ot.id AS open_task_id, ot.contract_id, ot.device_id, ot.priority, ot.delivery_address,
              idev.installation_address_text AS current_installation_address_text
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         JOIN open_tasks ot ON ot.id = vt.source_open_task_id
         JOIN installed_devices idev ON idev.id = ot.device_id
        WHERE vt.id = $1
        LIMIT 1`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير مرتبط بمهمة مفتوحة');

    const vt = vtRows[0];
    if (vt.task_type !== 'device_installation') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" - هذا المسار خاص بتركيب الجهاز فقط`);
    }
    if (!isPositiveInteger(vt.device_id)) {
      throw new ResultValidationError('device_installation يجب أن يرتبط بجهاز مثبت');
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة - الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`المهمة في حالة "${vt.status}" ولا تقبل تسجيل نتيجة جديدة`);
    }

    const shape = assertInstallationShape(body);
    const notes = body.closing_notes ?? body.notes ?? null;

    const { rows: vtrRows } = await db.query(
      `INSERT INTO visit_task_results
         (visit_task_id, final_decision, reason_code, closing_notes, closed_by, closed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
       ON CONFLICT (visit_task_id) DO UPDATE SET
         final_decision = EXCLUDED.final_decision,
         reason_code    = EXCLUDED.reason_code,
         closing_notes  = EXCLUDED.closing_notes,
         closed_by      = EXCLUDED.closed_by,
         closed_at      = NOW(),
         updated_at     = NOW()
       RETURNING id`,
      [
        visitTaskId,
        shape.decision,
        shape.decision === 'installation_incomplete'
          ? String(body.installation_incomplete_reason_id)
          : shape.decision === 'refused_installation'
            ? String(body.installation_refusal_reason_id)
            : null,
        notes,
        performedByUserId,
      ],
    );
    const visitTaskResultId = Number(vtrRows[0].id);

    let createdActivationTaskId: number | null = null;
    const finalAddressText = optionalText(body.final_installation_address_text);
    const finalGeoUnitId = isPositiveInteger(body.final_installation_geo_unit_id)
      ? Number(body.final_installation_geo_unit_id)
      : null;
    const installationDate = optionalDate(vt.visit_date) ?? new Date().toISOString().slice(0, 10);
    const parts = shape.decision === 'installed_successfully'
      ? normalizeInstallationParts(body.parts)
      : [];
    const installationPayment = shape.decision === 'installed_successfully'
      ? normalizeInstallationPayment(body.installation_payment)
      : {};
    const installedByEmployeeId = await resolveEmployeeIdForUser(db, performedByUserId);

    if (shape.decision === 'installed_successfully') {
      await db.query(
        `UPDATE installed_devices
            SET status = 'installed',
                installation_date = COALESCE($2::date, installation_date),
                installation_geo_unit_id = $3,
                installation_address_text = $4,
                installation_lat = $5,
                installation_lng = $6,
                updated_at = NOW()
          WHERE id = $1`,
        [
          Number(vt.device_id),
          installationDate,
          finalGeoUnitId,
          finalAddressText,
          optionalNumber(body.final_installation_lat),
          optionalNumber(body.final_installation_lng),
        ],
      );

      const { rows: activeActivationRows } = await db.query(
        `SELECT id
           FROM open_tasks
          WHERE device_id = $1
            AND task_type = 'device_activation'
            AND status NOT IN ('completed', 'closed', 'cancelled')
          ORDER BY created_at DESC
          LIMIT 1`,
        [Number(vt.device_id)],
      );
      if (activeActivationRows.length > 0) {
        createdActivationTaskId = Number(activeActivationRows[0].id);
      } else {
        const { rows: activationRows } = await db.query(
          `INSERT INTO open_tasks (
             client_id, branch_id, task_type, task_family, reason, status,
             due_date, expected_date, priority, source, notes, created_by, origin,
             contract_id, device_id, creation_origin, delivery_address,
             source_context_type, source_context_id
           ) VALUES ($1, $2, 'device_activation', 'delivery', 'service_request', 'open',
             $3::date, $3::date, $4, 'system', $5, $6, 'device_installation_result',
             $7, $8, 'cascading_during_visit', $9, 'device_installation', $10)
           RETURNING id`,
          [
            Number(vt.client_id),
            Number(vt.branch_id),
            optionalDate(body.activation_due_date),
            vt.priority ?? 'medium',
            'Created from device_installation result',
            performedByUserId,
            vt.contract_id ?? null,
            Number(vt.device_id),
            finalAddressText ?? vt.current_installation_address_text ?? vt.delivery_address ?? null,
            Number(vt.open_task_id),
          ],
        );
        createdActivationTaskId = Number(activationRows[0].id);
      }

      await db.query('DELETE FROM device_installed_parts WHERE open_task_id = $1', [Number(vt.open_task_id)]);
      for (const part of parts.filter((p) => p.placement_state === 'installed')) {
        await db.query(
          `INSERT INTO device_installed_parts
             (device_id, open_task_id, spare_part_id, part_name_snapshot, part_code_snapshot,
              maintenance_type, unit_price, quantity, line_total, event_type, event_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'installed',$10::date,$11)`,
          [
            Number(vt.device_id),
            Number(vt.open_task_id),
            part.spare_part_id ?? null,
            part.part_name ?? `Part #${part.spare_part_id}`,
            part.part_code ?? null,
            part.maintenance_type ?? null,
            part.source === 'customer_stock' ? 0 : part.unit_price,
            part.quantity ?? 1,
            (part.source === 'customer_stock' ? 0 : (part.unit_price ?? 0)) * (part.quantity ?? 1),
            installationDate,
            part.notes ?? null,
          ],
        );
      }
    }

    const { rows: installationRows } = await db.query(
      `INSERT INTO visit_task_device_installation_results
         (visit_task_result_id, outcome,
          installation_incomplete_reason_id, installation_refusal_reason_id,
          activation_due_date, customer_acknowledged, receiver_name, receiver_signature,
          final_installation_geo_unit_id, final_installation_address_text,
          final_installation_lat, final_installation_lng,
          created_activation_task_id, installation_parts, installation_payment, technical_notes,
          installed_by_employee_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,NOW(),NOW())
       ON CONFLICT (visit_task_result_id) DO UPDATE SET
          outcome = EXCLUDED.outcome,
          installation_incomplete_reason_id = EXCLUDED.installation_incomplete_reason_id,
          installation_refusal_reason_id = EXCLUDED.installation_refusal_reason_id,
          activation_due_date = EXCLUDED.activation_due_date,
          customer_acknowledged = EXCLUDED.customer_acknowledged,
          receiver_name = EXCLUDED.receiver_name,
          receiver_signature = EXCLUDED.receiver_signature,
          final_installation_geo_unit_id = EXCLUDED.final_installation_geo_unit_id,
          final_installation_address_text = EXCLUDED.final_installation_address_text,
          final_installation_lat = EXCLUDED.final_installation_lat,
          final_installation_lng = EXCLUDED.final_installation_lng,
          created_activation_task_id = EXCLUDED.created_activation_task_id,
          installation_parts = EXCLUDED.installation_parts,
          installation_payment = EXCLUDED.installation_payment,
          technical_notes = EXCLUDED.technical_notes,
          installed_by_employee_id = EXCLUDED.installed_by_employee_id,
          updated_at = NOW()
       RETURNING id`,
      [
        visitTaskResultId,
        shape.decision,
        isPositiveInteger(body.installation_incomplete_reason_id) ? Number(body.installation_incomplete_reason_id) : null,
        isPositiveInteger(body.installation_refusal_reason_id) ? Number(body.installation_refusal_reason_id) : null,
        optionalDate(body.activation_due_date),
        shape.decision === 'installed_successfully' ? body.customer_acknowledged === true : null,
        shape.decision === 'installed_successfully' ? optionalText(body.receiver_name) : null,
        shape.decision === 'installed_successfully' ? optionalText(body.receiver_signature) : null,
        shape.decision === 'installed_successfully' ? finalGeoUnitId : null,
        shape.decision === 'installed_successfully' ? finalAddressText : null,
        shape.decision === 'installed_successfully' ? optionalNumber(body.final_installation_lat) : null,
        shape.decision === 'installed_successfully' ? optionalNumber(body.final_installation_lng) : null,
        createdActivationTaskId,
        JSON.stringify(parts),
        JSON.stringify(installationPayment),
        notes,
        installedByEmployeeId,
      ],
    );
    const deviceInstallationResultId = Number(installationRows[0].id);

    await db.query(
      `UPDATE visit_tasks
          SET status = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [shape.openTaskNewStatus === 'cancelled' ? 'cancelled' : 'completed', visitTaskId],
    );

    if (shape.openTaskNewStatus === 'needs_follow_up') {
      await db.query(
        `UPDATE open_tasks
            SET last_waiting_status = CASE
                  WHEN status IN ('open', 'needs_follow_up') THEN status
                  ELSE COALESCE(last_waiting_status, 'open')
                END,
                status = 'needs_follow_up',
                expected_date = COALESCE($2::date, expected_date),
                expected_time = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), optionalDate(body.expected_date)],
      );
    } else if (shape.openTaskNewStatus === 'cancelled') {
      await db.query(
        `UPDATE open_tasks
            SET status = 'cancelled',
                cancellation_reason = COALESCE($2, cancellation_reason),
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), notes ?? 'refused_installation'],
      );
    } else {
      await db.query(
        `UPDATE open_tasks
            SET last_waiting_status = CASE
                  WHEN status IN ('open', 'needs_follow_up') THEN status
                  ELSE last_waiting_status
                END,
                status = 'completed',
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id)],
      );
    }

    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);

    if (!useExternal) await db.query('COMMIT');

    return {
      visitTaskResultId,
      deviceInstallationResultId,
      openTaskNewStatus: shape.openTaskNewStatus,
      deviceNewStatus: shape.deviceNewStatus,
      createdActivationTaskId,
      visitCompleted: completion.completed,
    };
  } catch (err) {
    if (!useExternal) await db.query('ROLLBACK');
    throw err;
  } finally {
    if (!useExternal) (db as PoolClient).release();
  }
}

// ════════════════════════════════════════════════════════════════
// applyDeviceActivationResult
// ════════════════════════════════════════════════════════════════
// Records the field outcome that turns an installed device into an
// active device, or keeps the same activation task alive for follow-up.
// ════════════════════════════════════════════════════════════════
export async function applyDeviceActivationResult(
  visitTaskId: number,
  body: DeviceActivationResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<DeviceActivationReflectionResult> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();

  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status,
              ot.id AS open_task_id, ot.contract_id, ot.device_id,
              idev.status AS device_status
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         JOIN open_tasks ot ON ot.id = vt.source_open_task_id
         JOIN installed_devices idev ON idev.id = ot.device_id
        WHERE vt.id = $1
        LIMIT 1`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير مرتبط بمهمة مفتوحة');

    const vt = vtRows[0];
    if (vt.task_type !== 'device_activation') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" - هذا المسار خاص بتشغيل الجهاز فقط`);
    }
    if (!isPositiveInteger(vt.device_id)) {
      throw new ResultValidationError('device_activation يجب أن يرتبط بجهاز مثبت');
    }
    if (!['installed', 'active'].includes(String(vt.device_status))) {
      throw new ResultValidationError('لا يمكن تسجيل تشغيل لجهاز لم يصل إلى حالة مركّب');
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة - الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`المهمة في حالة "${vt.status}" ولا تقبل تسجيل نتيجة جديدة`);
    }

    const shape = assertActivationShape(body);
    const notes = body.closing_notes ?? body.notes ?? null;

    const { rows: vtrRows } = await db.query(
      `INSERT INTO visit_task_results
         (visit_task_id, final_decision, reason_code, closing_notes, closed_by, closed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
       ON CONFLICT (visit_task_id) DO UPDATE SET
         final_decision = EXCLUDED.final_decision,
         reason_code    = EXCLUDED.reason_code,
         closing_notes  = EXCLUDED.closing_notes,
         closed_by      = EXCLUDED.closed_by,
         closed_at      = NOW(),
         updated_at     = NOW()
       RETURNING id`,
      [
        visitTaskId,
        shape.decision,
        optionalText(body.reason_code),
        notes,
        performedByUserId,
      ],
    );
    const visitTaskResultId = Number(vtrRows[0].id);

    if (shape.decision === 'activated_successfully') {
      await db.query(
        `UPDATE installed_devices
            SET status = 'active',
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.device_id)],
      );

      if (vt.contract_id) {
        await db.query(
          `UPDATE contracts
              SET status = 'active',
                  updated_at = NOW()
            WHERE id = $1
              AND status NOT IN ('cancelled', 'discarded')`,
          [Number(vt.contract_id)],
        );
      }
    }

    const photos = Array.isArray(body.activation_photos) ? body.activation_photos : [];
    const { rows: activationRows } = await db.query(
      `INSERT INTO visit_task_device_activation_results
         (visit_task_result_id, outcome, tds_before, tds_after, pump_pressure,
          membrane_output, tank_pressure, uv_status, customer_trained,
          training_notes, activation_photos, activated_by_employee_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,NOW(),NOW())
       ON CONFLICT (visit_task_result_id) DO UPDATE SET
          outcome = EXCLUDED.outcome,
          tds_before = EXCLUDED.tds_before,
          tds_after = EXCLUDED.tds_after,
          pump_pressure = EXCLUDED.pump_pressure,
          membrane_output = EXCLUDED.membrane_output,
          tank_pressure = EXCLUDED.tank_pressure,
          uv_status = EXCLUDED.uv_status,
          customer_trained = EXCLUDED.customer_trained,
          training_notes = EXCLUDED.training_notes,
          activation_photos = EXCLUDED.activation_photos,
          activated_by_employee_id = EXCLUDED.activated_by_employee_id,
          updated_at = NOW()
       RETURNING id`,
      [
        visitTaskResultId,
        shape.decision,
        optionalNumber(body.tds_before),
        optionalNumber(body.tds_after),
        optionalNumber(body.pump_pressure),
        optionalText(body.membrane_output),
        optionalNumber(body.tank_pressure),
        optionalText(body.uv_status),
        body.customer_trained === true,
        optionalText(body.training_notes),
        JSON.stringify(photos),
        isPositiveInteger(body.activated_by_employee_id) ? Number(body.activated_by_employee_id) : null,
      ],
    );
    const deviceActivationResultId = Number(activationRows[0].id);

    await db.query(
      `UPDATE visit_tasks
          SET status = 'completed',
              updated_at = NOW()
        WHERE id = $1`,
      [visitTaskId],
    );

    if (shape.openTaskNewStatus === 'needs_follow_up') {
      await db.query(
        `UPDATE open_tasks
            SET last_waiting_status = CASE
                  WHEN status IN ('open', 'needs_follow_up') THEN status
                  ELSE COALESCE(last_waiting_status, 'open')
                END,
                status = 'needs_follow_up',
                expected_date = COALESCE($2::date, expected_date),
                expected_time = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), optionalDate(body.expected_date), optionalText(body.expected_time)],
      );
    } else {
      await db.query(
        `UPDATE open_tasks
            SET last_waiting_status = CASE
                  WHEN status IN ('open', 'needs_follow_up') THEN status
                  ELSE last_waiting_status
                END,
                status = 'completed',
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id)],
      );
    }

    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);

    if (!useExternal) await db.query('COMMIT');

    return {
      visitTaskResultId,
      deviceActivationResultId,
      openTaskNewStatus: shape.openTaskNewStatus,
      deviceNewStatus: shape.deviceNewStatus,
      visitCompleted: completion.completed,
    };
  } catch (err) {
    if (!useExternal) await db.query('ROLLBACK');
    throw err;
  } finally {
    if (!useExternal) (db as PoolClient).release();
  }
}

// ════════════════════════════════════════════════════════════════
// applyEmergencyMaintenanceLifecycleResult
// ════════════════════════════════════════════════════════════════
// Slim reflection for emergency_maintenance "reschedule" / "cancel"
// outcomes — the "apply maintenance" outcome still goes through the
// existing /api/emergency-result wizard (saveCosts).
//
// Mirrors device_demo lifecycle semantics:
//   - rescheduled → open_task.status = needs_follow_up + expected_date
//   - cancelled   → open_task.status = cancelled
// Writes visit_task_results with reason_code + closing_notes, marks
// visit_task as completed/cancelled, then calls checkAndCompleteVisit.
// ════════════════════════════════════════════════════════════════
export interface EmergencyLifecycleBody {
  final_decision: 'rescheduled' | 'cancelled';
  reason_code_id: number;
  expected_date?: string | null;   // required for rescheduled
  closing_notes?: string | null;
}

export async function applyEmergencyMaintenanceLifecycleResult(
  visitTaskId: number,
  body: EmergencyLifecycleBody,
  performedByUserId: number,
  externalDb?: PoolClient,
) {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();
  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status, fv.branch_id
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
        WHERE vt.id = $1 LIMIT 1`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير موجود');
    const vt = vtRows[0];
    if (vt.task_type !== 'emergency_maintenance') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" غير مدعوم لهذا المسار`);
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة — الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`المهمة في حالة "${vt.status}" ولا تقبل تسجيل نتيجة جديدة`);
    }

    const decision = body.final_decision;
    if (decision !== 'rescheduled' && decision !== 'cancelled') {
      throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
    }
    if (!body.reason_code_id || !Number.isFinite(Number(body.reason_code_id))) {
      throw new ResultValidationError('reason_code_id مطلوب');
    }
    if (decision === 'rescheduled' && !body.expected_date) {
      throw new ResultValidationError('expected_date مطلوب');
    }

    // visit_task_results — single row per visit_task
    const { rows: vtrRows } = await db.query(
      `INSERT INTO visit_task_results
         (visit_task_id, final_decision, reason_code, closing_notes, closed_by, closed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
       ON CONFLICT (visit_task_id) DO UPDATE SET
         final_decision = EXCLUDED.final_decision,
         reason_code    = EXCLUDED.reason_code,
         closing_notes  = COALESCE(EXCLUDED.closing_notes, visit_task_results.closing_notes),
         closed_by      = EXCLUDED.closed_by,
         closed_at      = NOW(),
         updated_at     = NOW()
       RETURNING id`,
      [visitTaskId, decision, String(body.reason_code_id), body.closing_notes ?? null, performedByUserId],
    );

    // visit_tasks.status
    const newVtStatus = decision === 'cancelled' ? 'cancelled' : 'completed';
    await db.query(
      `UPDATE visit_tasks SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newVtStatus, visitTaskId],
    );

    // Reflect onto open_tasks
    if (vt.source_open_task_id) {
      if (decision === 'cancelled') {
        await db.query(
          `UPDATE open_tasks
              SET status = 'cancelled',
                  cancellation_reason = COALESCE($2, cancellation_reason),
                  updated_at = NOW()
            WHERE id = $1`,
          [vt.source_open_task_id, body.closing_notes ?? null],
        );
      } else {
        await db.query(
          `UPDATE open_tasks
              SET last_waiting_status = CASE
                    WHEN status IN ('open', 'needs_follow_up') THEN status
                    ELSE COALESCE(last_waiting_status, 'open')
                  END,
                  status = 'needs_follow_up',
                  expected_date = COALESCE($2::date, expected_date),
                  updated_at = NOW()
            WHERE id = $1`,
          [vt.source_open_task_id, body.expected_date ?? null],
        );
      }
    }

    // Auto-advance the visit if guards pass
    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);

    if (!useExternal) await db.query('COMMIT');
    return {
      visitTaskResultId: vtrRows[0].id,
      openTaskNewStatus: decision === 'cancelled' ? 'cancelled' : 'needs_follow_up',
      visitCompleted: completion.completed,
    };
  } catch (err) {
    if (!useExternal) await db.query('ROLLBACK');
    throw err;
  } finally {
    if (!useExternal) (db as PoolClient).release();
  }
}

export { ResultValidationError };
