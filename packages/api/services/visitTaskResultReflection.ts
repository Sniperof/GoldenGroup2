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
import { recordContractPaymentMovement, recordMovement } from './financialMovements.js';
import { createInstallmentCollectionTask } from './installmentCollectionTasks.js';
import { findUnavailableDeviceModelsForNewCommercialUse } from './catalogActiveStateService.js';

export type DeviceDemoFinalDecision =
  | 'offer_presented'
  | 'device_sold'
  | 'rescheduled'
  | 'cancelled';

export type DeviceDeliveryFinalDecision =
  | 'delivered_successfully'
  | 'rescheduled'
  | 'delivery_failed'
  // Legacy values accepted for backward compatibility.
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

export type DeviceCheckupFinalDecision =
  | 'checked_successfully'
  | 'reschedule'
  | 'customer_refused_checkup';

export type DeviceRetrievalFinalDecision =
  | 'retrieved_successfully'
  | 'reschedule'
  | 'customer_refused_retrieval';

export type DeviceReturnFinalDecision =
  | 'returned_successfully'
  | 'reschedule'
  | 'customer_refused_return';

export type DeviceTransferFinalDecision =
  | 'transferred_successfully'
  | 'reschedule'
  | 'customer_refused_transfer';

export type GiftDeliveryFinalDecision =
  | 'delivered_successfully'
  | 'refused_gift'
  | 'rescheduled';

export type DeviceDisconnectionFinalDecision =
  | 'disconnected_successfully'
  | 'rescheduled'
  | 'disconnection_failed'
  // Legacy values accepted for backward compatibility.
  | 'not_disconnected'
  | 'customer_refused_disconnection'
  | 'requires_retrieval'
  | 'unsafe_to_disconnect';

export type InstallmentCollectionFinalDecision =
  | 'paid_full'
  | 'paid_partial'
  | 'rescheduled'
  | 'refused_to_pay';

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
  reschedule_reason_id?: number | string | null;
  failure_reason_id?: number | string | null;
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
  // Integrated technical health reading (constitution 01i) — replaces the old
  // ad-hoc tds/pump/membrane/uv fields. Written to device_technical_states.
  technical_state?: Record<string, unknown> | null;
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

export interface DeviceCheckupResultBody {
  final_decision: DeviceCheckupFinalDecision;
  technical_state?: Record<string, unknown> | null;
  technical_notes?: string | null;
  refusal_reason_id?: number | null;
  reschedule_reason_id?: number | null;
  expected_date?: string | null;
  expected_time?: string | null;
  closing_notes?: string | null;
  notes?: string | null;
}

export interface DeviceCheckupReflectionResult {
  visitTaskResultId: number;
  deviceCheckupResultId: number;
  technicalStateId: number | null;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  visitCompleted: boolean;
}

export interface DeviceRetrievalResultBody {
  final_decision: DeviceRetrievalFinalDecision;
  retrieval_purpose?: 'maintenance' | 'replacement' | null;
  service_branch_id?: number | null;
  refusal_reason_id?: number | null;
  reschedule_reason_id?: number | null;
  expected_date?: string | null;
  expected_time?: string | null;
  customer_acknowledged?: boolean | null;
  technical_notes?: string | null;
  closing_notes?: string | null;
  notes?: string | null;
}

export interface DeviceRetrievalReflectionResult {
  visitTaskResultId: number;
  deviceRetrievalResultId: number;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'in_workshop' | 'retrieved' | 'unchanged';
  cancelledOpenTaskIds: number[];
  visitCompleted: boolean;
}

export interface DeviceReturnResultBody {
  final_decision: DeviceReturnFinalDecision;
  refusal_reason_id?: number | null;
  reschedule_reason_id?: number | null;
  expected_date?: string | null;
  expected_time?: string | null;
  actual_return_date?: string | null;
  customer_acknowledged?: boolean | null;
  technical_notes?: string | null;
  closing_notes?: string | null;
  notes?: string | null;
}

export interface DeviceReturnReflectionResult {
  visitTaskResultId: number;
  deviceReturnResultId: number;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'delivered' | 'unchanged';
  visitCompleted: boolean;
}

export interface DeviceTransferResultBody {
  final_decision: DeviceTransferFinalDecision;
  transfer_kind?: 'same_customer_new_address' | 'another_customer' | null;
  target_client_id?: number | null;
  planned_geo_unit_id?: number | null;
  planned_address_text?: string | null;
  planned_lat?: number | null;
  planned_lng?: number | null;
  refusal_reason_id?: number | null;
  reschedule_reason_id?: number | null;
  expected_date?: string | null;
  expected_time?: string | null;
  customer_acknowledged?: boolean | null;
  target_customer_acknowledged?: boolean | null;
  technical_notes?: string | null;
  closing_notes?: string | null;
  notes?: string | null;
}

export interface DeviceTransferReflectionResult {
  visitTaskResultId: number;
  deviceTransferResultId: number;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'delivered' | 'unchanged';
  ownershipTransferred: boolean;
  visitCompleted: boolean;
}

export interface DeviceDisconnectionResultBody {
  final_decision: DeviceDisconnectionFinalDecision;
  closing_notes?: string | null;
  notes?: string | null;
  reason_code?: string | null;
  expected_date?: string | null;
  expected_time?: string | null;
  reschedule_reason_id?: number | string | null;
  failure_reason_id?: number | string | null;
  device_left_on_site?: boolean | null;
  water_disconnected?: boolean | null;
  electricity_disconnected?: boolean | null;
  accessories_removed?: boolean | null;
  customer_acknowledged?: boolean | null;
  requires_retrieval_task?: boolean | null;
  retrieval_reason?: string | null;
  disconnected_by_employee_id?: number | null;
  technical_notes?: string | null;
}

export interface DeviceDisconnectionReflectionResult {
  visitTaskResultId: number;
  deviceDisconnectionResultId: number;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'out_of_service' | 'unchanged';
  visitCompleted: boolean;
}

// جزء دفع واحد ضمن تسديد ذمة — يد/حوالة/مقايضة، بالليرة أو الدولار بسعر صرف.
// (نموذج العقد بدون تقسيط؛ نفس بنية PaymentEntriesList في الواجهة.)
export interface CollectionPaymentPart {
  method: 'hand' | 'transfer' | 'barter';
  amountValue: number | string;
  currency?: 'syp' | 'usd';
  exchangeRate?: number | string | null;
  transferCompanyId?: number | string | null;
  barterDescription?: string | null;
}

export interface InstallmentCollectionResultBody {
  final_decision: InstallmentCollectionFinalDecision;
  closing_notes?: string | null;
  // دفعات متعددة (المسار الموحّد). إن وُجدت تُعتمد بدل paid_amount_syp المفرد.
  payment_parts?: CollectionPaymentPart[] | null;
  paid_amount_syp?: number | string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  received_by_employee_id?: number | null;
  partial_payment_reason_id?: number | null;
  reschedule_reason_id?: number | null;
  refusal_reason_id?: number | null;
  next_expected_date?: string | null;
  next_priority?: 'high' | 'medium' | 'low' | null;
}

export interface InstallmentCollectionReflectionResult {
  visitTaskResultId: number;
  installmentCollectionResultId: number;
  openTaskNewStatus: 'completed' | 'cancelled';
  paymentEntryId: number | null;
  createdFollowupTaskId: number | null;
  remainingAfterSyp: number;
  visitCompleted: boolean;
}

// قيمة جزء الدفع بالليرة: المقايضة = قيمتها مباشرة، الدولار = القيمة × سعر الصرف.
function collectionPartSyp(p: CollectionPaymentPart): number {
  const v = Number(p.amountValue) || 0;
  if (p.method === 'barter') return v;
  if (p.currency === 'usd') return v * (Number(p.exchangeRate) || 0);
  return v;
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

function normalizePriority(value: unknown): 'high' | 'medium' | 'low' | null {
  return value === 'high' || value === 'medium' || value === 'low' ? value : null;
}

function hasAnyReading(reading: unknown): reading is Record<string, unknown> {
  if (!reading || typeof reading !== 'object') return false;
  return Object.values(reading).some((value) => value !== null && value !== undefined && value !== '');
}

async function assertSystemListCategory(
  db: Pick<PoolClient, 'query'>,
  id: unknown,
  category: string,
  label: string,
): Promise<number> {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ResultValidationError(`${label} مطلوب`);
  }
  const { rows } = await db.query(
    `SELECT id
       FROM system_lists
      WHERE id = $1
        AND category = $2
        AND is_active = TRUE
      LIMIT 1`,
    [parsed, category],
  );
  if (rows.length === 0) {
    throw new ResultValidationError(`${label} غير صالح`);
  }
  return parsed;
}

// camelCase reading key → device_technical_states column (constitution 01i).
async function assertSystemListValue(
  db: Pick<PoolClient, 'query'>,
  value: unknown,
  category: string,
  label: string,
): Promise<string> {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (!parsed) {
    throw new ResultValidationError(`${label} مطلوب`);
  }
  const { rows } = await db.query(
    `SELECT value
       FROM system_lists
      WHERE category = $1
        AND value = $2
        AND is_active = TRUE
      LIMIT 1`,
    [category, parsed],
  );
  if (rows.length === 0) {
    throw new ResultValidationError(`${label} غير صالح`);
  }
  return parsed;
}

const TECH_STATE_COLUMN_MAP: Record<string, string> = {
  waterSourceType: 'water_source_type', waterSourceTds: 'water_source_tds',
  waterPressure: 'water_pressure', hasPressureRegulator: 'has_pressure_regulator',
  tapTdsBefore: 'tap_tds_before', pumpPressure: 'pump_pressure',
  membraneOutputTds: 'membrane_output_tds', membraneInputTds: 'membrane_input_tds',
  membraneFlow: 'membrane_flow', flowCupSize: 'flow_cup_size',
  sterilizationTransformer: 'sterilization_transformer', uvLamp: 'uv_lamp',
  sterilizationSleeve: 'sterilization_sleeve', highPressureTds: 'high_pressure_tds',
  lowPressureSwitch: 'low_pressure_switch', tankTds: 'tank_tds',
  valveType: 'valve_type', pumpTransformer: 'pump_transformer',
  hasFifthTap: 'has_fifth_tap', deviceConnection: 'device_connection',
  additionalNotes: 'additional_notes',
};

// Append a device-keyed technical health reading. No-op when no measurement was
// recorded. Enforces device + task linkage via the table's NOT VALID checks.
// Exported for reuse by other field-task result paths (e.g. golden warranty
// offer, constitution 01i §2 — any field task is a valid source task).
export async function insertTechnicalState(
  db: Pick<PoolClient, 'query'>,
  args: {
    installedDeviceId: number;
    openTaskId: number;
    contractId: number | null;
    taskTypeSnapshot: string;
    phase: 'pre' | 'post' | 'diagnostic' | 'baseline';
    recordedBy: number | null;
    reading: Record<string, unknown> | null;
  },
): Promise<number | null> {
  const reading = args.reading;
  if (!reading || typeof reading !== 'object') return null;
  const hasAny = Object.values(reading).some((v) => v !== null && v !== undefined && v !== '');
  if (!hasAny) return null;

  const cols = ['installed_device_id', 'open_task_id', 'contract_id', 'task_type_snapshot', 'phase', 'recorded_by'];
  const vals: unknown[] = [args.installedDeviceId, args.openTaskId, args.contractId, args.taskTypeSnapshot, args.phase, args.recordedBy];
  for (const [camel, col] of Object.entries(TECH_STATE_COLUMN_MAP)) {
    if (camel in reading) { cols.push(col); vals.push((reading as any)[camel] ?? null); }
  }
  const params = vals.map((_, i) => `$${i + 1}`);
  const { rows } = await db.query(
    `INSERT INTO device_technical_states (${cols.join(', ')}) VALUES (${params.join(', ')}) RETURNING id`,
    vals,
  );
  return Number(rows[0].id);
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
  if (![
    'delivered_successfully',
    'rescheduled',
    'delivery_failed',
    'customer_not_available',
    'wrong_address',
    'refused_delivery',
  ].includes(decision)) {
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

  if ((decision === 'rescheduled' || decision === 'customer_not_available' || decision === 'wrong_address') && !optionalDate(body.expected_date)) {
    throw new ResultValidationError('expected_date مطلوب عند إعادة المتابعة');
  }

  if (decision === 'rescheduled' && !isPositiveInteger(body.reschedule_reason_id)) {
    throw new ResultValidationError('سبب إعادة جدولة التسليم مطلوب');
  }
  if (decision === 'delivery_failed' && !isPositiveInteger(body.failure_reason_id)) {
    throw new ResultValidationError('سبب فشل التسليم مطلوب');
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
  if (decision === 'delivery_failed' || decision === 'refused_delivery') {
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

  if (decision === 'activation_failed') {
    if (!optionalText(body.reason_code)) {
      throw new ResultValidationError('سبب فشل التشغيل مطلوب');
    }
    return { decision, openTaskNewStatus: 'completed', deviceNewStatus: 'installed' };
  }

  if (!optionalText(body.reason_code)) {
    throw new ResultValidationError('سبب إعادة جدولة التشغيل مطلوب');
  }
  if (!optionalDate(body.expected_date)) {
    throw new ResultValidationError('تاريخ المتابعة مطلوب عند وجود مشكلة بالجهاز');
  }
  return { decision, openTaskNewStatus: 'needs_follow_up', deviceNewStatus: 'installed' };
}

function assertDisconnectionShape(body: DeviceDisconnectionResultBody): {
  decision: DeviceDisconnectionFinalDecision;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'out_of_service' | 'unchanged';
} {
  const decision = body.final_decision;
  if (![
    'disconnected_successfully',
    'rescheduled',
    'disconnection_failed',
    'not_disconnected',
    'customer_refused_disconnection',
    'requires_retrieval',
    'unsafe_to_disconnect',
  ].includes(decision)) {
    throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
  }

  if (!optionalText(body.reason_code) && decision !== 'disconnected_successfully' && decision !== 'rescheduled' && decision !== 'disconnection_failed') {
    throw new ResultValidationError('سبب نتيجة فك الجهاز مطلوب');
  }

  if (decision === 'disconnected_successfully') {
    if (body.water_disconnected !== true && body.electricity_disconnected !== true && body.accessories_removed !== true) {
      throw new ResultValidationError('يجب توثيق إجراء فني واحد على الأقل عند نجاح فك الجهاز');
    }
    if (body.requires_retrieval_task === true && !optionalText(body.retrieval_reason)) {
      throw new ResultValidationError('سبب السحب اللاحق مطلوب عند طلب سحب بعد الفك');
    }
    return { decision, openTaskNewStatus: 'completed', deviceNewStatus: 'out_of_service' };
  }

  if (decision === 'requires_retrieval') {
    if (!optionalText(body.retrieval_reason)) {
      throw new ResultValidationError('سبب السحب اللاحق مطلوب عند اختيار يتطلب سحباً');
    }
    return { decision, openTaskNewStatus: 'completed', deviceNewStatus: 'out_of_service' };
  }

  if (decision === 'disconnection_failed') {
    if (!isPositiveInteger(body.failure_reason_id)) {
      throw new ResultValidationError('سبب فشل فك الجهاز مطلوب');
    }
    return { decision, openTaskNewStatus: 'cancelled', deviceNewStatus: 'unchanged' };
  }

  if (decision === 'customer_refused_disconnection') {
    return { decision, openTaskNewStatus: 'cancelled', deviceNewStatus: 'unchanged' };
  }

  if (!optionalDate(body.expected_date)) {
    throw new ResultValidationError('تاريخ المتابعة مطلوب عند عدم تنفيذ فك الجهاز');
  }
  if (decision === 'rescheduled' && !isPositiveInteger(body.reschedule_reason_id)) {
    throw new ResultValidationError('سبب إعادة جدولة فك الجهاز مطلوب');
  }
  return { decision, openTaskNewStatus: 'needs_follow_up', deviceNewStatus: 'unchanged' };
}

function assertRetrievalShape(
  body: DeviceRetrievalResultBody,
  openTask: { retrieval_purpose?: string | null; service_branch_id?: number | null },
): {
  decision: DeviceRetrievalFinalDecision;
  retrievalPurpose: 'maintenance' | 'replacement';
  serviceBranchId: number;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'in_workshop' | 'retrieved' | 'unchanged';
} {
  const decision = body.final_decision;
  if (!['retrieved_successfully', 'reschedule', 'customer_refused_retrieval'].includes(decision)) {
    throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
  }

  const purpose = body.retrieval_purpose ?? openTask.retrieval_purpose;
  if (purpose !== 'maintenance' && purpose !== 'replacement') {
    throw new ResultValidationError('غرض السحب مطلوب ويجب أن يكون maintenance أو replacement');
  }

  const serviceBranchId = Number(body.service_branch_id ?? openTask.service_branch_id);
  if (!Number.isInteger(serviceBranchId) || serviceBranchId <= 0) {
    throw new ResultValidationError('فرع الخدمة مطلوب لمهمة سحب الجهاز');
  }

  if (decision === 'retrieved_successfully') {
    if (body.customer_acknowledged !== true) {
      throw new ResultValidationError('تأكيد الزبون مطلوب عند نجاح سحب الجهاز');
    }
    return {
      decision,
      retrievalPurpose: purpose,
      serviceBranchId,
      openTaskNewStatus: 'completed',
      deviceNewStatus: purpose === 'maintenance' ? 'in_workshop' : 'retrieved',
    };
  }

  if (decision === 'reschedule') {
    if (!optionalDate(body.expected_date)) {
      throw new ResultValidationError('تاريخ إعادة الجدولة مطلوب');
    }
    return {
      decision,
      retrievalPurpose: purpose,
      serviceBranchId,
      openTaskNewStatus: 'needs_follow_up',
      deviceNewStatus: 'unchanged',
    };
  }

  return {
    decision,
    retrievalPurpose: purpose,
    serviceBranchId,
    openTaskNewStatus: 'cancelled',
    deviceNewStatus: 'unchanged',
  };
}

function assertReturnShape(body: DeviceReturnResultBody): {
  decision: DeviceReturnFinalDecision;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'delivered' | 'unchanged';
} {
  const decision = body.final_decision;
  if (!['returned_successfully', 'reschedule', 'customer_refused_return'].includes(decision)) {
    throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
  }

  if (decision === 'returned_successfully') {
    if (body.customer_acknowledged !== true) {
      throw new ResultValidationError('تأكيد الزبون مطلوب عند نجاح إرجاع الجهاز');
    }
    return { decision, openTaskNewStatus: 'completed', deviceNewStatus: 'delivered' };
  }

  if (decision === 'reschedule') {
    if (!optionalDate(body.expected_date)) {
      throw new ResultValidationError('تاريخ إعادة الجدولة مطلوب');
    }
    return { decision, openTaskNewStatus: 'needs_follow_up', deviceNewStatus: 'unchanged' };
  }

  return { decision, openTaskNewStatus: 'cancelled', deviceNewStatus: 'unchanged' };
}

function assertTransferShape(
  body: DeviceTransferResultBody,
  openTask: {
    transfer_kind?: string | null;
    target_client_id?: number | null;
    planned_transfer_geo_unit_id?: number | null;
    planned_transfer_address_text?: string | null;
    planned_transfer_lat?: number | null;
    planned_transfer_lng?: number | null;
  },
): {
  decision: DeviceTransferFinalDecision;
  transferKind: 'same_customer_new_address' | 'another_customer';
  targetClientId: number | null;
  plannedGeoUnitId: number;
  plannedAddressText: string;
  plannedLat: number | null;
  plannedLng: number | null;
  openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled';
  deviceNewStatus: 'delivered' | 'unchanged';
} {
  const decision = body.final_decision;
  if (!['transferred_successfully', 'reschedule', 'customer_refused_transfer'].includes(decision)) {
    throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
  }

  const transferKind = body.transfer_kind ?? openTask.transfer_kind;
  if (transferKind !== 'same_customer_new_address' && transferKind !== 'another_customer') {
    throw new ResultValidationError('نوع النقل مطلوب ويجب أن يكون same_customer_new_address أو another_customer');
  }

  const targetClientId = Number(body.target_client_id ?? openTask.target_client_id) || null;
  if (transferKind === 'another_customer' && (!targetClientId || !Number.isInteger(targetClientId))) {
    throw new ResultValidationError('الزبون الجديد مطلوب عند نقل الجهاز إلى زبون آخر');
  }

  const plannedGeoUnitId = Number(body.planned_geo_unit_id ?? openTask.planned_transfer_geo_unit_id);
  const plannedAddressText = optionalText(body.planned_address_text) ?? optionalText(openTask.planned_transfer_address_text);
  if (!Number.isInteger(plannedGeoUnitId) || plannedGeoUnitId <= 0 || !plannedAddressText) {
    throw new ResultValidationError('العنوان المبدئي الجديد يتطلب حيّاً وعنواناً تفصيلياً');
  }

  if (decision === 'transferred_successfully') {
    if (body.customer_acknowledged !== true) {
      throw new ResultValidationError('تأكيد الزبون مطلوب عند نجاح نقل الجهاز');
    }
    if (transferKind === 'another_customer' && body.target_customer_acknowledged !== true) {
      throw new ResultValidationError('تأكيد الزبون الجديد مطلوب عند نقل الجهاز إلى زبون آخر');
    }
    return {
      decision,
      transferKind,
      targetClientId,
      plannedGeoUnitId,
      plannedAddressText,
      plannedLat: optionalNumber(body.planned_lat) ?? optionalNumber(openTask.planned_transfer_lat),
      plannedLng: optionalNumber(body.planned_lng) ?? optionalNumber(openTask.planned_transfer_lng),
      openTaskNewStatus: 'completed',
      deviceNewStatus: 'delivered',
    };
  }

  if (decision === 'reschedule') {
    if (!optionalDate(body.expected_date)) {
      throw new ResultValidationError('تاريخ إعادة الجدولة مطلوب');
    }
    return {
      decision,
      transferKind,
      targetClientId,
      plannedGeoUnitId,
      plannedAddressText,
      plannedLat: optionalNumber(body.planned_lat) ?? optionalNumber(openTask.planned_transfer_lat),
      plannedLng: optionalNumber(body.planned_lng) ?? optionalNumber(openTask.planned_transfer_lng),
      openTaskNewStatus: 'needs_follow_up',
      deviceNewStatus: 'unchanged',
    };
  }

  return {
    decision,
    transferKind,
    targetClientId,
    plannedGeoUnitId,
    plannedAddressText,
    plannedLat: optionalNumber(body.planned_lat) ?? optionalNumber(openTask.planned_transfer_lat),
    plannedLng: optionalNumber(body.planned_lng) ?? optionalNumber(openTask.planned_transfer_lng),
    openTaskNewStatus: 'cancelled',
    deviceNewStatus: 'unchanged',
  };
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
      for (const [idx, offer] of body.offers.entries()) {
        if (offer.customer_response === 'rejected') {
          offer.no_closing_reason = await assertSystemListValue(
            db,
            offer.no_closing_reason,
            'device_demo_offer_refusal_reasons',
            `العرض #${idx + 1}: سبب الرفض`,
          );
        }
      }
      const unavailableDeviceModels = await findUnavailableDeviceModelsForNewCommercialUse(
        db,
        body.offers.map((offer) => offer.device_model_id),
      );
      if (unavailableDeviceModels.length > 0) {
        throw new ResultValidationError(`device_model unavailable for new commercial use: ${unavailableDeviceModels.map((item) => item.id).join(', ')}`);
      }
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
      const unavailableDeviceModels = await findUnavailableDeviceModelsForNewCommercialUse(db, [body.sold_device_model_id]);
      if (unavailableDeviceModels.length > 0) {
        throw new ResultValidationError(`device_model unavailable for new commercial use: ${unavailableDeviceModels.map((item) => item.id).join(', ')}`);
      }
      openTaskNewStatus = 'completed';
    } else if (decision === 'rescheduled') {
      if (!isPositiveNumber(body.reason_code_id)) throw new ResultValidationError('reason_code_id مطلوب');
      if (!body.expected_date) throw new ResultValidationError('expected_date مطلوب');
      body.reason_code_id = await assertSystemListCategory(
        db,
        body.reason_code_id,
        'device_demo_reschedule_reasons',
        'سبب إعادة الجدولة',
      );
      openTaskNewStatus = 'needs_follow_up';
      openTaskExpectedDate = body.expected_date;
    } else if (decision === 'cancelled') {
      if (!isPositiveNumber(body.reason_code_id)) throw new ResultValidationError('reason_code_id مطلوب');
      body.reason_code_id = await assertSystemListCategory(
        db,
        body.reason_code_id,
        'device_demo_cancellation_reasons',
        'سبب الإلغاء',
      );
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

// ── Golden warranty: OFFER result (DEC-CT-17) ────────────────────────────────
// 3 outcomes: activated (create+activate a warranty per accepted device + baseline
// 01i reading + payments) / rescheduled (needs_follow_up) / cancelled (rejected).
interface GoldenOfferPaymentInput {
  method: string;
  amountValue?: number | null;
  currency?: string;
  exchangeRate?: number | null;
  amountSyp?: number | null;
  referenceNumber?: string | null;
  barterName?: string | null;
  barterValueSyp?: number | null;
  transferCompanyId?: number | null;
  entryType?: string;
  notes?: string | null;
}
interface GoldenOfferInstallmentInput {
  installmentNumber: number;
  dueDate: string;
  amountSyp: number;
}
interface GoldenOfferDeviceInput {
  installedDeviceId: number;
  months: number;
  totalValue?: number | null;
  visits?: number | null;
  reading?: Record<string, unknown> | null;
  // DEC-CT-17: three-axis payment + optional installment plan.
  paymentType?: 'cash' | 'installment';
  payments?: GoldenOfferPaymentInput[];
  installments?: GoldenOfferInstallmentInput[];
}
interface GoldenOfferResultBody {
  final_decision: 'activated' | 'rescheduled' | 'cancelled';
  receipt_date?: string | null;
  devices?: GoldenOfferDeviceInput[];
  reason_code?: string | null;
  expected_date?: string | null;
  expected_time?: string | null;
  closing_notes?: string | null;
}

interface GiftDeliveryResultBody {
  final_decision: GiftDeliveryFinalDecision;
  customer_acknowledged?: boolean;
  refusal_reason_id?: number | string | null;
  reschedule_reason_id?: number | string | null;
  rescheduled_date?: string | null;
  notes?: string | null;
  closing_notes?: string | null;
}

export async function applyGiftDeliveryResult(
  visitTaskId: number,
  body: GiftDeliveryResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<{ visitTaskResultId: number; openTaskNewStatus: string; giftRecordIds: number[]; visitCompleted: boolean }> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();
  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
        WHERE vt.id = $1
        LIMIT 1`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير موجود');
    const vt = vtRows[0];
    if (vt.task_type !== 'gift_delivery') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" غير مدعوم في نتيجة تسليم الهدية`);
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة - الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!vt.source_open_task_id) {
      throw new ResultValidationError('مهمة تسليم الهدية يجب أن ترتبط بمهمة مفتوحة');
    }

    const decision = body.final_decision;
    if (!['delivered_successfully', 'refused_gift', 'rescheduled'].includes(decision)) {
      throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
    }
    if (decision === 'delivered_successfully' && body.customer_acknowledged !== true) {
      throw new ResultValidationError('إقرار الزبون بالاستلام مطلوب عند نجاح تسليم الهدية');
    }
    if (decision === 'refused_gift' && !isPositiveInteger(body.refusal_reason_id)) {
      throw new ResultValidationError('سبب رفض الهدية مطلوب');
    }
    if (decision === 'rescheduled') {
      if (!isPositiveInteger(body.reschedule_reason_id)) throw new ResultValidationError('سبب إعادة الجدولة مطلوب');
      if (!optionalDate(body.rescheduled_date)) throw new ResultValidationError('تاريخ إعادة الجدولة مطلوب');
    }

    const refusalReasonId = decision === 'refused_gift'
      ? await assertSystemListCategory(db, body.refusal_reason_id, 'gift_delivery_refusal_reasons', 'سبب رفض الهدية')
      : null;
    const rescheduleReasonId = decision === 'rescheduled'
      ? await assertSystemListCategory(db, body.reschedule_reason_id, 'gift_delivery_reschedule_reasons', 'سبب إعادة الجدولة')
      : null;

    const { rows: recordRows } = await db.query(
      `SELECT gr.id,
              gr.gift_definition_id,
              gr.approved_quantity,
              gd.default_unit_label
         FROM gift_records gr
         JOIN gift_definitions gd ON gd.id = gr.gift_definition_id
        WHERE gr.delivery_task_id = $1
          AND gr.status = 'delivery_task_created'
        ORDER BY gr.id`,
      [vt.source_open_task_id],
    );
    if (recordRows.length === 0) {
      throw new ResultValidationError('لا توجد سجلات هدايا نشطة مرتبطة بمهمة التسليم');
    }
    const giftRecordIds = recordRows.map((row: any) => Number(row.id));
    const closingNotes = optionalText(body.closing_notes) ?? optionalText(body.notes);

    const { rows: vtrRows } = await db.query(
      `INSERT INTO visit_task_results
         (visit_task_id, final_decision, reason_code, closing_notes, closed_by, closed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
       ON CONFLICT (visit_task_id) DO UPDATE SET
         final_decision = EXCLUDED.final_decision,
         reason_code = EXCLUDED.reason_code,
         closing_notes = EXCLUDED.closing_notes,
         closed_by = EXCLUDED.closed_by,
         closed_at = NOW(),
         updated_at = NOW()
       RETURNING id`,
      [
        visitTaskId,
        decision,
        decision === 'refused_gift'
          ? String(body.refusal_reason_id)
          : decision === 'rescheduled'
            ? String(body.reschedule_reason_id)
            : null,
        closingNotes,
        performedByUserId,
      ],
    );
    const visitTaskResultId = Number(vtrRows[0].id);

    await db.query(
      `INSERT INTO visit_task_gift_delivery_results (
         visit_task_result_id, gift_record_id, gift_definition_id,
         approved_quantity_snapshot, unit_label_snapshot,
         final_decision, customer_acknowledged,
         refusal_reason_id, reschedule_reason_id, rescheduled_date, notes,
         created_at, updated_at
       )
       SELECT $1, gr.id, gr.gift_definition_id, gr.approved_quantity, gd.default_unit_label,
              $2, $3, $4, $5, $6::date, $7, NOW(), NOW()
         FROM gift_records gr
         JOIN gift_definitions gd ON gd.id = gr.gift_definition_id
        WHERE gr.id = ANY($8::int[])
       ON CONFLICT (visit_task_result_id, gift_record_id) DO UPDATE SET
         gift_definition_id = EXCLUDED.gift_definition_id,
         approved_quantity_snapshot = EXCLUDED.approved_quantity_snapshot,
         unit_label_snapshot = EXCLUDED.unit_label_snapshot,
         final_decision = EXCLUDED.final_decision,
         customer_acknowledged = EXCLUDED.customer_acknowledged,
         refusal_reason_id = EXCLUDED.refusal_reason_id,
         reschedule_reason_id = EXCLUDED.reschedule_reason_id,
         rescheduled_date = EXCLUDED.rescheduled_date,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [
        visitTaskResultId,
        decision,
        body.customer_acknowledged === true,
        refusalReasonId,
        rescheduleReasonId,
        optionalDate(body.rescheduled_date),
        closingNotes,
        giftRecordIds,
      ],
    );

    let openTaskNewStatus: 'completed' | 'cancelled' | 'needs_follow_up';
    if (decision === 'delivered_successfully') {
      openTaskNewStatus = 'completed';
      await db.query(
        `UPDATE gift_records
            SET status = 'delivered', updated_by = $2, updated_at = NOW()
          WHERE id = ANY($1::int[])`,
        [giftRecordIds, performedByUserId],
      );
    } else if (decision === 'refused_gift') {
      openTaskNewStatus = 'cancelled';
      await db.query(
        `UPDATE gift_records
            SET status = 'refused', updated_by = $2, updated_at = NOW()
          WHERE id = ANY($1::int[])`,
        [giftRecordIds, performedByUserId],
      );
    } else {
      openTaskNewStatus = 'needs_follow_up';
    }

    await db.query(
      `UPDATE visit_tasks
          SET status = 'completed', updated_at = NOW()
        WHERE id = $1`,
      [visitTaskId],
    );

    if (openTaskNewStatus === 'needs_follow_up') {
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
        [vt.source_open_task_id, optionalDate(body.rescheduled_date)],
      );
    } else if (openTaskNewStatus === 'cancelled') {
      await db.query(
        `UPDATE open_tasks
            SET status = 'cancelled',
                cancellation_reason = COALESCE($2, cancellation_reason),
                updated_at = NOW()
          WHERE id = $1`,
        [vt.source_open_task_id, closingNotes ?? 'refused_gift'],
      );
    } else {
      await db.query(
        `UPDATE open_tasks
            SET status = 'completed', updated_at = NOW()
          WHERE id = $1`,
        [vt.source_open_task_id],
      );
    }

    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);
    if (!useExternal) await db.query('COMMIT');
    return { visitTaskResultId, openTaskNewStatus, giftRecordIds, visitCompleted: completion.completed };
  } catch (err) {
    if (!useExternal) await db.query('ROLLBACK');
    throw err;
  } finally {
    if (!useExternal) (db as PoolClient).release();
  }
}

export async function applyGoldenWarrantyOfferResult(
  visitTaskId: number,
  body: GoldenOfferResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<{ visitTaskResultId: number; openTaskNewStatus: string; visitCompleted: boolean; createdWarrantyIds: number[] }> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();
  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status, fv.branch_id, ot.contract_id
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         LEFT JOIN open_tasks ot ON ot.id = vt.source_open_task_id
        WHERE vt.id = $1 LIMIT 1`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير موجود');
    const vt = vtRows[0];
    if (vt.task_type !== 'golden_warranty_offer') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" — هذا الـ service لعرض الكفالة الذهبية فقط`);
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة — الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`المهمة في حالة "${vt.status}" ولا تقبل تسجيل نتيجة جديدة`);
    }

    const decision = body.final_decision;
    if (!['activated', 'rescheduled', 'cancelled'].includes(decision)) {
      throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
    }

    let openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled' = 'completed';
    let openTaskExpectedDate: string | null = null;

    if (decision === 'rescheduled') {
      if (!body.reason_code) throw new ResultValidationError('سبب التفعيل لاحقاً مطلوب');
      if (!optionalDate(body.expected_date)) throw new ResultValidationError('التاريخ المتوقع مطلوب');
      openTaskNewStatus = 'needs_follow_up';
      openTaskExpectedDate = body.expected_date ?? null;
    } else if (decision === 'cancelled') {
      if (!body.reason_code) throw new ResultValidationError('سبب الرفض مطلوب');
      openTaskNewStatus = 'cancelled';
    } else {
      if (!Array.isArray(body.devices) || body.devices.length === 0) {
        throw new ResultValidationError('يجب تحديد جهاز واحد على الأقل للتفعيل');
      }
    }

    const { rows: vtrRows } = await db.query(
      `INSERT INTO visit_task_results
         (visit_task_id, final_decision, reason_code, closing_notes, closed_by, closed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
       ON CONFLICT (visit_task_id) DO UPDATE SET
         final_decision = EXCLUDED.final_decision, reason_code = EXCLUDED.reason_code,
         closing_notes = EXCLUDED.closing_notes, closed_by = EXCLUDED.closed_by,
         closed_at = NOW(), updated_at = NOW()
       RETURNING id`,
      [visitTaskId, decision, body.reason_code ?? null, body.closing_notes ?? null, performedByUserId],
    );
    const visitTaskResultId: number = vtrRows[0].id;

    const createdWarrantyIds: number[] = [];
    if (decision === 'activated') {
      const receiptDate = body.receipt_date ?? new Date().toISOString().slice(0, 10);
      for (const d of body.devices!) {
        const deviceId = Number(d.installedDeviceId);
        const months = Number(d.months);
        if (!Number.isFinite(deviceId) || !Number.isFinite(months) || months <= 0) {
          throw new ResultValidationError('بيانات الجهاز أو المدة غير صالحة');
        }
        const { rows: act } = await db.query(
          `SELECT id FROM device_warranties WHERE device_id=$1 AND status='active' AND end_date > $2 LIMIT 1`,
          [deviceId, receiptDate],
        );
        if (act[0]) throw new ResultValidationError(`الجهاز #${deviceId} عليه كفالة فعّالة لم تنتهِ بعد`);
        const totalValue = d.totalValue != null ? Number(d.totalValue) : null;
        const paymentType: 'cash' | 'installment' = d.paymentType === 'installment' ? 'installment' : 'cash';
        const installments = paymentType === 'installment' && Array.isArray(d.installments) ? d.installments : [];
        if (paymentType === 'installment') {
          if (totalValue == null || !(totalValue > 0)) {
            throw new ResultValidationError(`الجهاز #${deviceId}: قيمة الكفالة مطلوبة عند الدفع بالتقسيط`);
          }
          if (installments.length === 0) {
            throw new ResultValidationError(`الجهاز #${deviceId}: يجب توليد أقساط عند الدفع بالتقسيط`);
          }
        }
        const installmentsCount = paymentType === 'installment' ? installments.length : null;
        const { rows: wRows } = await db.query(
          `INSERT INTO device_warranties
             (device_id, warranty_type, start_date, end_date, months, visits, total_value,
              status, activated_at, source_task_id, offer_task_id, payment_type, installments_count)
           VALUES ($1,'golden',$2,($2::date + make_interval(months => $3::int))::date,$3::int,$4,$5,'active',now(),$6,$6,$7,$8)
           RETURNING id`,
          [deviceId, receiptDate, months, d.visits ?? null, totalValue, vt.source_open_task_id,
           paymentType, installmentsCount],
        );
        const warrantyId: number = wRows[0].id;
        createdWarrantyIds.push(warrantyId);

        // Installment schedule (mirrors contract_installments). Confirmed on
        // creation since the plan is agreed at activation time.
        for (const inst of installments) {
          const amt = Number(inst.amountSyp) || 0;
          await db.query(
            `INSERT INTO device_warranty_installments
               (warranty_id, installment_number, due_date, amount_syp, remaining_balance, confirmed)
             VALUES ($1,$2,$3,$4,$4,true)`,
            [warrantyId, inst.installmentNumber, inst.dueDate, amt],
          );
        }

        await insertTechnicalState(db, {
          installedDeviceId: deviceId,
          openTaskId: vt.source_open_task_id,
          contractId: vt.contract_id ?? null,
          taskTypeSnapshot: 'golden_warranty_offer',
          phase: 'baseline',
          recordedBy: performedByUserId,
          reading: d.reading ?? null,
        });

        if (Array.isArray(d.payments)) {
          for (const p of d.payments) {
            const isBarter = p.method === 'barter';
            const av = Number(p.amountValue) || 0;
            // Non-barter rows need a positive amount; barter carries its value
            // in barter_value_syp instead.
            if (!isBarter && !(av > 0)) continue;
            const er = p.exchangeRate != null ? Number(p.exchangeRate) : null;
            const syp = p.amountSyp != null ? Number(p.amountSyp)
              : isBarter ? (Number(p.barterValueSyp) || 0)
              : (er ? av * er : av);
            if (!(syp >= 0) || (isBarter && !(syp > 0))) continue;
            await db.query(
              `INSERT INTO device_warranty_payments
                 (warranty_id, method, currency, amount_value, exchange_rate, amount_syp,
                  reference_number, barter_name, barter_value_syp, transfer_company_id,
                  received_by_employee_id, notes, entry_type)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [warrantyId, p.method, p.currency ?? 'SYP', av, er, syp,
               p.referenceNumber ?? null, p.barterName ?? null,
               isBarter ? syp : (p.barterValueSyp ?? null),
               p.transferCompanyId ?? null, performedByUserId,
               p.notes ?? null, p.entryType ?? 'collection'],
            );
          }
        }

        await db.query(
          `UPDATE installed_devices d SET golden_warranty_end_date = (
             SELECT MAX(w.end_date) FROM device_warranties w
              WHERE w.device_id = d.id AND w.warranty_type='golden' AND w.status='active')
           WHERE d.id = $1`,
          [deviceId],
        );
      }
    }

    const newVtStatus = decision === 'cancelled' ? 'cancelled' : 'completed';
    await db.query(`UPDATE visit_tasks SET status = $1, updated_at = NOW() WHERE id = $2`, [newVtStatus, visitTaskId]);

    if (vt.source_open_task_id) {
      if (openTaskNewStatus === 'cancelled') {
        await db.query(
          `UPDATE open_tasks SET status='cancelled', cancellation_reason=COALESCE($2, cancellation_reason), updated_at=NOW() WHERE id=$1`,
          [vt.source_open_task_id, body.reason_code ?? null],
        );
      } else if (openTaskNewStatus === 'needs_follow_up') {
        await db.query(
          `UPDATE open_tasks SET last_waiting_status = CASE WHEN status IN ('open','needs_follow_up') THEN status ELSE COALESCE(last_waiting_status,'open') END,
                  status='needs_follow_up', expected_date=COALESCE($2::date, expected_date), expected_time=COALESCE($3, expected_time), updated_at=NOW() WHERE id=$1`,
          [vt.source_open_task_id, openTaskExpectedDate, body.expected_time ?? null],
        );
      } else {
        await db.query(`UPDATE open_tasks SET status='completed', updated_at=NOW() WHERE id=$1`, [vt.source_open_task_id]);
      }
    }

    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);
    if (!useExternal) await db.query('COMMIT');
    return { visitTaskResultId, openTaskNewStatus, visitCompleted: completion.completed, createdWarrantyIds };
  } catch (err) {
    if (!useExternal) await db.query('ROLLBACK');
    throw err;
  } finally {
    if (!useExternal) (db as PoolClient).release();
  }
}

// ── Golden warranty: CARD DELIVERY result (DEC-CT-17) ────────────────────────
// 3 outcomes: delivered (recipient + auto date, stamps card_delivery_task_id) /
// rescheduled (needs_follow_up) / cancelled (rejected receipt).
interface GoldenCardResultBody {
  final_decision: 'delivered' | 'rescheduled' | 'cancelled';
  recipient_type?: 'customer' | 'other';
  recipient_name?: string | null;
  reason_code?: string | null;
  expected_date?: string | null;
  expected_time?: string | null;
  closing_notes?: string | null;
}

export async function applyGoldenWarrantyCardDeliveryResult(
  visitTaskId: number,
  body: GoldenCardResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<{ visitTaskResultId: number; openTaskNewStatus: string; visitCompleted: boolean; deliveredCount: number }> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();
  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status, ot.device_id
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         LEFT JOIN open_tasks ot ON ot.id = vt.source_open_task_id
        WHERE vt.id = $1 LIMIT 1`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير موجود');
    const vt = vtRows[0];
    if (vt.task_type !== 'golden_warranty_card_delivery') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" — هذا الـ service لتسليم كرت الكفالة فقط`);
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة — الزيارة في حالة "${vt.visit_status}"`);
    }

    const decision = body.final_decision;
    if (!['delivered', 'rescheduled', 'cancelled'].includes(decision)) {
      throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
    }

    let openTaskNewStatus: 'completed' | 'needs_follow_up' | 'cancelled' = 'completed';
    let openTaskExpectedDate: string | null = null;
    let closingNotes = body.closing_notes ?? null;

    if (decision === 'rescheduled') {
      if (!body.reason_code) throw new ResultValidationError('سبب إعادة الجدولة مطلوب');
      if (!optionalDate(body.expected_date)) throw new ResultValidationError('التاريخ المتوقع مطلوب');
      openTaskNewStatus = 'needs_follow_up';
      openTaskExpectedDate = body.expected_date ?? null;
    } else if (decision === 'cancelled') {
      if (!body.reason_code) throw new ResultValidationError('سبب الرفض مطلوب');
      openTaskNewStatus = 'cancelled';
    } else {
      const recipient = body.recipient_type === 'other' ? (body.recipient_name ?? '').trim() : 'الزبون';
      if (body.recipient_type === 'other' && !recipient) {
        throw new ResultValidationError('اسم المستلِم مطلوب عند التسليم لشخص آخر');
      }
      closingNotes = `تم تسليم الكرت إلى: ${recipient}${closingNotes ? ` — ${closingNotes}` : ''}`;
    }

    const { rows: vtrRows } = await db.query(
      `INSERT INTO visit_task_results
         (visit_task_id, final_decision, reason_code, closing_notes, closed_by, closed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
       ON CONFLICT (visit_task_id) DO UPDATE SET
         final_decision = EXCLUDED.final_decision, reason_code = EXCLUDED.reason_code,
         closing_notes = EXCLUDED.closing_notes, closed_by = EXCLUDED.closed_by,
         closed_at = NOW(), updated_at = NOW()
       RETURNING id`,
      [visitTaskId, decision, body.reason_code ?? null, closingNotes, performedByUserId],
    );
    const visitTaskResultId: number = vtrRows[0].id;

    let deliveredCount = 0;
    if (decision === 'delivered') {
      // The task may combine several cards — stamp every linked device's active
      // golden warranty (fallback to the single open_tasks.device_id).
      const { rows: devRows } = await db.query(
        `SELECT installed_device_id FROM open_task_installed_devices WHERE task_id = $1`,
        [vt.source_open_task_id],
      );
      const deviceIds: number[] = devRows.length > 0
        ? devRows.map((r: any) => Number(r.installed_device_id))
        : (vt.device_id ? [Number(vt.device_id)] : []);
      for (const did of deviceIds) {
        const upd = await db.query(
          `UPDATE device_warranties SET card_delivery_task_id = $1, updated_at = now()
            WHERE id = (SELECT id FROM device_warranties
                         WHERE device_id = $2 AND warranty_type='golden' AND status='active'
                         ORDER BY end_date DESC LIMIT 1)`,
          [vt.source_open_task_id, did],
        );
        deliveredCount += upd.rowCount ?? 0;
      }
    }

    const newVtStatus = decision === 'cancelled' ? 'cancelled' : 'completed';
    await db.query(`UPDATE visit_tasks SET status = $1, updated_at = NOW() WHERE id = $2`, [newVtStatus, visitTaskId]);

    if (vt.source_open_task_id) {
      if (openTaskNewStatus === 'cancelled') {
        await db.query(
          `UPDATE open_tasks SET status='cancelled', cancellation_reason=COALESCE($2, cancellation_reason), updated_at=NOW() WHERE id=$1`,
          [vt.source_open_task_id, body.reason_code ?? null],
        );
      } else if (openTaskNewStatus === 'needs_follow_up') {
        await db.query(
          `UPDATE open_tasks SET last_waiting_status = CASE WHEN status IN ('open','needs_follow_up') THEN status ELSE COALESCE(last_waiting_status,'open') END,
                  status='needs_follow_up', expected_date=COALESCE($2::date, expected_date), expected_time=COALESCE($3, expected_time), updated_at=NOW() WHERE id=$1`,
          [vt.source_open_task_id, openTaskExpectedDate, body.expected_time ?? null],
        );
      } else {
        await db.query(`UPDATE open_tasks SET status='completed', updated_at=NOW() WHERE id=$1`, [vt.source_open_task_id]);
      }
    }

    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);
    if (!useExternal) await db.query('COMMIT');
    return { visitTaskResultId, openTaskNewStatus, visitCompleted: completion.completed, deliveredCount };
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
    let rescheduleReasonId: number | null = null;
    let failureReasonId: number | null = null;
    if (shape.decision === 'rescheduled') {
      rescheduleReasonId = await assertSystemListCategory(
        db,
        body.reschedule_reason_id,
        'device_delivery_reschedule_reasons',
        'سبب إعادة جدولة التسليم',
      );
    }
    if (shape.decision === 'delivery_failed') {
      failureReasonId = await assertSystemListCategory(
        db,
        body.failure_reason_id,
        'device_delivery_failure_reasons',
        'سبب فشل التسليم',
      );
    }
    const reasonCode =
      rescheduleReasonId != null ? String(rescheduleReasonId)
        : failureReasonId != null ? String(failureReasonId)
          : optionalText(body.reason_code);

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
        reasonCode,
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
           new_installation_lat, new_installation_lng,
           reschedule_reason_id, failure_reason_id, rescheduled_at,
           created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::date,$24,$25,$26,$27,$28,$29,$30,$31::date,NOW(),NOW())
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
           reschedule_reason_id = EXCLUDED.reschedule_reason_id,
           failure_reason_id = EXCLUDED.failure_reason_id,
           rescheduled_at = EXCLUDED.rescheduled_at,
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
        rescheduleReasonId,
        failureReasonId,
        optionalDate(body.expected_date),
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
        [vt.open_task_id, body.closing_notes ?? body.notes ?? reasonCode ?? 'delivery_failed'],
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
           contract_id, device_id, creation_origin, creation_reason, delivery_address,
           source_context_type, source_context_id
         ) VALUES ($1, $2, 'device_installation', 'delivery', 'service_request', 'open',
           $3::date, $4, 'system', $5, $6, 'device_delivery_result',
           $7, $8, 'cascading_during_visit', 'تركيب بعد نجاح التسليم', $9, 'device_delivery', $10)
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

    // سجل الحركات المالية: بيع قطع التركيب (charge) والمبلغ المحصّل (payment).
    if (vt.client_id) {
      const partsCharge = Number((installationPayment as any).total_parts_amount) || 0;
      const collected = Number((installationPayment as any).total_paid_syp) || 0;
      await recordMovement(db, {
        clientId: Number(vt.client_id), occurredAt: installationDate, kind: 'charge', amountSyp: partsCharge,
        sourceType: 'installation', sourceId: Number(vt.open_task_id), sourceRefId: deviceInstallationResultId,
        contractId: vt.contract_id ?? null, description: `بيع قطع عند التركيب (مهمة #${vt.open_task_id})`,
        occurredBranchId: vt.branch_id ?? null, recordedBy: performedByUserId,
      });
      await recordMovement(db, {
        clientId: Number(vt.client_id), occurredAt: installationDate, kind: 'payment', amountSyp: collected,
        sourceType: 'installation', sourceId: Number(vt.open_task_id), sourceRefId: deviceInstallationResultId,
        contractId: vt.contract_id ?? null, description: `تحصيل عند التركيب (مهمة #${vt.open_task_id})`,
        occurredBranchId: vt.branch_id ?? null, recordedBy: performedByUserId,
      });
    }

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
    const activationReasonCode = shape.decision === 'activation_failed'
      ? await assertSystemListValue(db, body.reason_code, 'device_activation_failure_reasons', 'سبب فشل التشغيل')
      : shape.decision === 'device_issue'
        ? await assertSystemListValue(db, body.reason_code, 'device_activation_reschedule_reasons', 'سبب إعادة جدولة التشغيل')
        : null;

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
        activationReasonCode,
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
        // NOTE: contracts has no updated_at column (only created_at).
        await db.query(
          `UPDATE contracts
              SET status = 'active'
            WHERE id = $1
              AND status NOT IN ('cancelled', 'discarded')`,
          [Number(vt.contract_id)],
        );
      }
    }

    const photos = Array.isArray(body.activation_photos) ? body.activation_photos : [];
    // Technical measurements moved to device_technical_states (constitution 01i);
    // only activation-specific data stays here (outcome, training, photos).
    const { rows: activationRows } = await db.query(
      `INSERT INTO visit_task_device_activation_results
         (visit_task_result_id, outcome, customer_trained,
          training_notes, activation_photos, activated_by_employee_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,NOW(),NOW())
       ON CONFLICT (visit_task_result_id) DO UPDATE SET
          outcome = EXCLUDED.outcome,
          customer_trained = EXCLUDED.customer_trained,
          training_notes = EXCLUDED.training_notes,
          activation_photos = EXCLUDED.activation_photos,
          activated_by_employee_id = EXCLUDED.activated_by_employee_id,
          updated_at = NOW()
       RETURNING id`,
      [
        visitTaskResultId,
        shape.decision,
        body.customer_trained === true,
        optionalText(body.training_notes),
        JSON.stringify(photos),
        isPositiveInteger(body.activated_by_employee_id) ? Number(body.activated_by_employee_id) : null,
      ],
    );
    const deviceActivationResultId = Number(activationRows[0].id);

    // Integrated technical health reading — baseline reference at first operation,
    // keyed on the physical device (constitution 01i §4). Same transaction.
    if (shape.decision === 'activated_successfully') {
      await insertTechnicalState(db, {
        installedDeviceId: Number(vt.device_id),
        openTaskId: Number(vt.open_task_id),
        contractId: vt.contract_id != null ? Number(vt.contract_id) : null,
        taskTypeSnapshot: 'device_activation',
        phase: 'baseline',
        recordedBy: performedByUserId,
        reading: body.technical_state ?? null,
      });
    }

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
// applyDeviceDisconnectionResult
// ════════════════════════════════════════════════════════════════
// Records فك الجهاز: a field-side technical stop/disconnection. It never
// implies possession transfer; retrieval/workshop movement must be recorded
// through a separate task or possession event.
// ════════════════════════════════════════════════════════════════
export async function applyDeviceDisconnectionResult(
  visitTaskId: number,
  body: DeviceDisconnectionResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<DeviceDisconnectionReflectionResult> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();

  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status,
              ot.id AS open_task_id, ot.device_id,
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
    if (vt.task_type !== 'device_disconnection') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" - هذا المسار خاص بفك الجهاز فقط`);
    }
    if (!isPositiveInteger(vt.device_id)) {
      throw new ResultValidationError('مهمة فك الجهاز يجب أن ترتبط بجهاز مثبت');
    }
    if (!['active', 'out_of_service'].includes(String(vt.device_status))) {
      throw new ResultValidationError('لا يمكن تسجيل فك إلا لجهاز كان فعالاً عند إنشاء المهمة');
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة - الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`المهمة في حالة "${vt.status}" ولا تقبل تسجيل نتيجة جديدة`);
    }

    const shape = assertDisconnectionShape(body);
    const notes = body.closing_notes ?? body.notes ?? null;
    let rescheduleReasonId: number | null = null;
    let failureReasonId: number | null = null;
    if (shape.decision === 'rescheduled') {
      rescheduleReasonId = await assertSystemListCategory(
        db,
        body.reschedule_reason_id,
        'device_disconnection_reschedule_reasons',
        'سبب إعادة جدولة فك الجهاز',
      );
    }
    if (shape.decision === 'disconnection_failed') {
      failureReasonId = await assertSystemListCategory(
        db,
        body.failure_reason_id,
        'device_disconnection_failure_reasons',
        'سبب فشل فك الجهاز',
      );
    }
    const reasonCode =
      rescheduleReasonId != null ? String(rescheduleReasonId)
        : failureReasonId != null ? String(failureReasonId)
          : optionalText(body.reason_code);
    const requiresRetrieval = shape.decision === 'disconnected_successfully' && body.requires_retrieval_task === true;
    const retrievalReason = requiresRetrieval
      ? await assertSystemListValue(
          db,
          body.retrieval_reason,
          'device_disconnection_retrieval_reasons',
          'سبب السحب اللاحق لفك الجهاز',
        )
      : null;

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
        reasonCode,
        notes,
        performedByUserId,
      ],
    );
    const visitTaskResultId = Number(vtrRows[0].id);

    if (shape.deviceNewStatus === 'out_of_service') {
      await db.query(
        `UPDATE installed_devices
            SET status = 'out_of_service',
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.device_id)],
      );
    }

    const { rows: disconnectionRows } = await db.query(
       `INSERT INTO visit_task_device_disconnection_results
          (visit_task_result_id, outcome, device_left_on_site,
           water_disconnected, electricity_disconnected, accessories_removed,
           customer_acknowledged, requires_retrieval_task, retrieval_reason,
           disconnected_by_employee_id, technical_notes,
           reschedule_reason_id, failure_reason_id, rescheduled_at,
           created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date,NOW(),NOW())
       ON CONFLICT (visit_task_result_id) DO UPDATE SET
          outcome = EXCLUDED.outcome,
          device_left_on_site = EXCLUDED.device_left_on_site,
          water_disconnected = EXCLUDED.water_disconnected,
          electricity_disconnected = EXCLUDED.electricity_disconnected,
          accessories_removed = EXCLUDED.accessories_removed,
          customer_acknowledged = EXCLUDED.customer_acknowledged,
          requires_retrieval_task = EXCLUDED.requires_retrieval_task,
          retrieval_reason = EXCLUDED.retrieval_reason,
           disconnected_by_employee_id = EXCLUDED.disconnected_by_employee_id,
           technical_notes = EXCLUDED.technical_notes,
           reschedule_reason_id = EXCLUDED.reschedule_reason_id,
           failure_reason_id = EXCLUDED.failure_reason_id,
           rescheduled_at = EXCLUDED.rescheduled_at,
           updated_at = NOW()
       RETURNING id`,
      [
        visitTaskResultId,
        shape.decision,
        body.device_left_on_site !== false,
        body.water_disconnected === true,
        body.electricity_disconnected === true,
        body.accessories_removed === true,
        body.customer_acknowledged === true ? true : (body.customer_acknowledged === false ? false : null),
        requiresRetrieval,
        retrievalReason,
        isPositiveInteger(body.disconnected_by_employee_id) ? Number(body.disconnected_by_employee_id) : null,
        optionalText(body.technical_notes),
        rescheduleReasonId,
        failureReasonId,
        optionalDate(body.expected_date),
      ],
    );
    const deviceDisconnectionResultId = Number(disconnectionRows[0].id);

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
                expected_time = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), optionalDate(body.expected_date), optionalText(body.expected_time)],
      );
    } else if (shape.openTaskNewStatus === 'cancelled') {
      await db.query(
        `UPDATE open_tasks
            SET status = 'cancelled',
                cancellation_reason = COALESCE($2, cancellation_reason),
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), notes ?? reasonCode ?? 'disconnection_failed'],
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
      deviceDisconnectionResultId,
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
// applyInstallmentCollectionResult
// ════════════════════════════════════════════════════════════════
// Records "تسديد ذمة" outcomes for the existing installment_collection task.
// One result targets one contract_installments row. Partial payment and
// reschedule close the current task and spawn a fresh collection task for the
// same installment after the current task is terminal.
// ════════════════════════════════════════════════════════════════
export async function applyDeviceRetrievalResult(
  visitTaskId: number,
  body: DeviceRetrievalResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<DeviceRetrievalReflectionResult> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();

  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status,
              ot.id AS open_task_id, ot.status AS open_task_status, ot.device_id,
              ot.retrieval_purpose, ot.service_branch_id,
              idev.status AS device_status,
              idev.branch_id AS current_device_branch_id,
              idev.installation_geo_unit_id AS current_device_geo_unit_id,
              idev.installation_address_text AS current_device_address_text,
              idev.installation_lat AS current_device_lat,
              idev.installation_lng AS current_device_lng,
              br.location_geo_id AS service_branch_geo_id,
              br.detailed_address AS service_branch_address,
              br.status AS service_branch_status
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         JOIN open_tasks ot ON ot.id = vt.source_open_task_id
         JOIN installed_devices idev ON idev.id = ot.device_id
         JOIN branches br ON br.id = ot.service_branch_id
        WHERE vt.id = $1
        LIMIT 1
        FOR UPDATE OF vt, ot, idev`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير مرتبط بمهمة سحب جهاز');

    const vt = vtRows[0];
    if (vt.task_type !== 'device_retrieval') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" - هذا المسار خاص بسحب الجهاز فقط`);
    }
    if (!isPositiveInteger(vt.device_id)) {
      throw new ResultValidationError('مهمة سحب الجهاز يجب أن ترتبط بجهاز مثبت');
    }
    if (vt.device_status !== 'out_of_service') {
      throw new ResultValidationError('لا يمكن تسجيل سحب إلا لجهاز حالته out_of_service');
    }
    if (vt.service_branch_status === 'inactive') {
      throw new ResultValidationError('فرع الخدمة المحدد موقوف عن العمل');
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة - الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`المهمة في حالة "${vt.status}" ولا تقبل تسجيل نتيجة جديدة`);
    }

    const shape = assertRetrievalShape(body, vt);
    let refusalReasonId: number | null = null;
    let rescheduleReasonId: number | null = null;

    if (shape.decision === 'customer_refused_retrieval') {
      refusalReasonId = await assertSystemListCategory(
        db,
        body.refusal_reason_id,
        'device_retrieval_refusal_reasons',
        'سبب رفض سحب الجهاز',
      );
    }
    if (shape.decision === 'reschedule') {
      rescheduleReasonId = await assertSystemListCategory(
        db,
        body.reschedule_reason_id,
        'device_retrieval_reschedule_reasons',
        'سبب إعادة جدولة سحب الجهاز',
      );
    }

    const notes = body.closing_notes ?? body.notes ?? null;
    const reasonCode =
      refusalReasonId != null ? String(refusalReasonId)
      : rescheduleReasonId != null ? String(rescheduleReasonId)
      : shape.retrievalPurpose;

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
      [visitTaskId, shape.decision, reasonCode, notes, performedByUserId],
    );
    const visitTaskResultId = Number(vtrRows[0].id);

    const { rows: retrievalRows } = await db.query(
      `INSERT INTO visit_task_device_retrieval_results
         (visit_task_result_id, final_decision, retrieval_purpose, service_branch_id,
          refusal_reason_id, reschedule_reason_id, rescheduled_at,
          customer_acknowledged, technical_notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,NOW(),NOW())
       ON CONFLICT (visit_task_result_id) DO UPDATE SET
          final_decision = EXCLUDED.final_decision,
          retrieval_purpose = EXCLUDED.retrieval_purpose,
          service_branch_id = EXCLUDED.service_branch_id,
          refusal_reason_id = EXCLUDED.refusal_reason_id,
          reschedule_reason_id = EXCLUDED.reschedule_reason_id,
          rescheduled_at = EXCLUDED.rescheduled_at,
          customer_acknowledged = EXCLUDED.customer_acknowledged,
          technical_notes = EXCLUDED.technical_notes,
          updated_at = NOW()
       RETURNING id`,
      [
        visitTaskResultId,
        shape.decision,
        shape.retrievalPurpose,
        shape.serviceBranchId,
        refusalReasonId,
        rescheduleReasonId,
        optionalDate(body.expected_date),
        body.customer_acknowledged === true ? true : (body.customer_acknowledged === false ? false : null),
        optionalText(body.technical_notes),
      ],
    );
    const deviceRetrievalResultId = Number(retrievalRows[0].id);

    if (shape.deviceNewStatus !== 'unchanged') {
      await db.query(
        `UPDATE open_tasks
            SET pre_retrieval_branch_id = COALESCE(pre_retrieval_branch_id, $2),
                pre_retrieval_geo_unit_id = COALESCE(pre_retrieval_geo_unit_id, $3),
                pre_retrieval_address_text = COALESCE(pre_retrieval_address_text, $4),
                pre_retrieval_lat = COALESCE(pre_retrieval_lat, $5),
                pre_retrieval_lng = COALESCE(pre_retrieval_lng, $6),
                updated_at = NOW()
          WHERE id = $1`,
        [
          Number(vt.open_task_id),
          vt.current_device_branch_id ?? null,
          vt.current_device_geo_unit_id ?? null,
          vt.current_device_address_text ?? null,
          vt.current_device_lat == null ? null : Number(vt.current_device_lat),
          vt.current_device_lng == null ? null : Number(vt.current_device_lng),
        ],
      );

      await db.query(
        `UPDATE installed_devices
            SET status = $2,
                branch_id = $3,
                installation_geo_unit_id = $4,
                installation_address_text = COALESCE($5, installation_address_text),
                updated_at = NOW()
          WHERE id = $1`,
        [
          Number(vt.device_id),
          shape.deviceNewStatus,
          shape.serviceBranchId,
          vt.service_branch_geo_id ?? null,
          vt.service_branch_address ?? null,
        ],
      );
    }

    const cancelledOpenTaskIds: number[] = [];
    if (shape.decision === 'retrieved_successfully' && shape.retrievalPurpose === 'replacement') {
      const employeeId = await resolveEmployeeIdForUser(db, performedByUserId);

      await db.query(
        `UPDATE device_possession_log
            SET end_at = NOW()
          WHERE device_id = $1
            AND end_at IS NULL`,
        [Number(vt.device_id)],
      );
      await db.query(
        `INSERT INTO device_possession_log
           (device_id, holder_type, holder_id, start_at, reason, notes, created_by)
         VALUES ($1, 'workshop', $2, NOW(), 'retrieval', $3, $4)`,
        [
          Number(vt.device_id),
          shape.serviceBranchId,
          notes ?? 'سحب الجهاز للتبديل',
          employeeId,
        ],
      );

      const { rows: cancelledRows } = await db.query(
        `UPDATE open_tasks
            SET status = 'cancelled',
                cancellation_reason = COALESCE(cancellation_reason, 'device_retrieved_for_replacement'),
                updated_at = NOW()
          WHERE device_id = $1
            AND id <> $2
            AND status NOT IN ('completed', 'closed', 'cancelled')
          RETURNING id`,
        [Number(vt.device_id), Number(vt.open_task_id)],
      );
      cancelledOpenTaskIds.push(...cancelledRows.map((row: any) => Number(row.id)));

      for (const cancelledId of cancelledOpenTaskIds) {
        await db.query(
          `INSERT INTO task_activity_log
             (task_id, event_type, performed_by, old_value, new_value, reason, reference_id, created_at)
           VALUES ($1, 'status_change', $2, NULL, 'cancelled', 'device_retrieved_for_replacement', $3, NOW())`,
          [cancelledId, performedByUserId, visitTaskResultId],
        );
      }
    }

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
                expected_time = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), optionalDate(body.expected_date), optionalText(body.expected_time)],
      );
    } else if (shape.openTaskNewStatus === 'cancelled') {
      await db.query(
        `UPDATE open_tasks
            SET status = 'cancelled',
                cancellation_reason = COALESCE($2, cancellation_reason),
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), notes ?? reasonCode],
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

    await db.query(
      `INSERT INTO task_activity_log
         (task_id, event_type, performed_by, old_value, new_value, reason, reference_id, created_at)
       VALUES ($1, 'status_change', $2, $3, $4, $5, $6, NOW())`,
      [
        Number(vt.open_task_id),
        performedByUserId,
        String(vt.open_task_status ?? ''),
        shape.openTaskNewStatus,
        shape.decision,
        visitTaskResultId,
      ],
    );

    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);

    if (!useExternal) await db.query('COMMIT');

    return {
      visitTaskResultId,
      deviceRetrievalResultId,
      openTaskNewStatus: shape.openTaskNewStatus,
      deviceNewStatus: shape.deviceNewStatus,
      cancelledOpenTaskIds,
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
// applyInstallmentCollectionResult
export async function applyDeviceCheckupResult(
  visitTaskId: number,
  body: DeviceCheckupResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<DeviceCheckupReflectionResult> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();

  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status,
              ot.id AS open_task_id, ot.status AS open_task_status, ot.device_id, ot.contract_id,
              idev.status AS device_status
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         JOIN open_tasks ot ON ot.id = vt.source_open_task_id
         JOIN installed_devices idev ON idev.id = ot.device_id
        WHERE vt.id = $1
        LIMIT 1
        FOR UPDATE OF vt, ot, idev`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير مرتبط بمهمة تشييك جهاز');

    const vt = vtRows[0];
    if (vt.task_type !== 'device_checkup') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" - هذا المسار خاص بتشييك الجهاز فقط`);
    }
    if (!isPositiveInteger(vt.device_id)) {
      throw new ResultValidationError('مهمة تشييك الجهاز يجب أن ترتبط بجهاز مثبت');
    }
    if (!['delivered', 'installed', 'active'].includes(String(vt.device_status))) {
      throw new ResultValidationError('لا يمكن تسجيل تشييك إلا لجهاز موجود عند الزبون');
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة - الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`المهمة في حالة "${vt.status}" ولا تقبل تسجيل نتيجة جديدة`);
    }
    const decision = body.final_decision;
    if (!['checked_successfully', 'reschedule', 'customer_refused_checkup'].includes(decision)) {
      throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
    }
    if (decision === 'checked_successfully' && !hasAnyReading(body.technical_state)) {
      throw new ResultValidationError('الحالة الفنية مطلوبة لتسجيل تشييك الجهاز');
    }

    let refusalReasonId: number | null = null;
    let rescheduleReasonId: number | null = null;
    if (decision === 'customer_refused_checkup') {
      refusalReasonId = await assertSystemListCategory(
        db,
        body.refusal_reason_id,
        'device_checkup_refusal_reasons',
        'سبب رفض تشييك الجهاز',
      );
    }
    if (decision === 'reschedule') {
      rescheduleReasonId = await assertSystemListCategory(
        db,
        body.reschedule_reason_id,
        'device_checkup_reschedule_reasons',
        'سبب إعادة جدولة تشييك الجهاز',
      );
      if (!optionalDate(body.expected_date)) {
        throw new ResultValidationError('تاريخ إعادة جدولة تشييك الجهاز مطلوب');
      }
    }

    const notes = body.closing_notes ?? body.notes ?? body.technical_notes ?? null;
    const reasonCode =
      refusalReasonId != null ? String(refusalReasonId)
      : rescheduleReasonId != null ? String(rescheduleReasonId)
      : 'device_checkup';
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
      [visitTaskId, decision, reasonCode, notes, performedByUserId],
    );
    const visitTaskResultId = Number(vtrRows[0].id);

    const technicalStateId = decision === 'checked_successfully'
      ? await insertTechnicalState(db, {
          installedDeviceId: Number(vt.device_id),
          openTaskId: Number(vt.open_task_id),
          contractId: vt.contract_id != null ? Number(vt.contract_id) : null,
          taskTypeSnapshot: 'device_checkup',
          phase: 'diagnostic',
          recordedBy: performedByUserId,
          reading: body.technical_state ?? null,
        })
      : null;
    if (decision === 'checked_successfully' && !technicalStateId) {
      throw new ResultValidationError('الحالة الفنية مطلوبة لتسجيل تشييك الجهاز');
    }

    const { rows: checkupRows } = await db.query(
      `INSERT INTO visit_task_device_checkup_results
         (visit_task_result_id, final_decision, technical_state_id,
          refusal_reason_id, reschedule_reason_id, rescheduled_at,
          technical_notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, NOW(), NOW())
       ON CONFLICT (visit_task_result_id) DO UPDATE SET
         final_decision = EXCLUDED.final_decision,
         technical_state_id = EXCLUDED.technical_state_id,
         refusal_reason_id = EXCLUDED.refusal_reason_id,
         reschedule_reason_id = EXCLUDED.reschedule_reason_id,
         rescheduled_at = EXCLUDED.rescheduled_at,
         technical_notes = EXCLUDED.technical_notes,
         updated_at = NOW()
       RETURNING id`,
      [
        visitTaskResultId,
        decision,
        technicalStateId,
        refusalReasonId,
        rescheduleReasonId,
        optionalDate(body.expected_date),
        optionalText(body.technical_notes),
      ],
    );
    const deviceCheckupResultId = Number(checkupRows[0].id);

    const openTaskNewStatus =
      decision === 'reschedule' ? 'needs_follow_up'
      : decision === 'customer_refused_checkup' ? 'cancelled'
      : 'completed';

    await db.query(
      `UPDATE visit_tasks
          SET status = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [openTaskNewStatus === 'cancelled' ? 'cancelled' : 'completed', visitTaskId],
    );
    if (openTaskNewStatus === 'needs_follow_up') {
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
    } else if (openTaskNewStatus === 'cancelled') {
      await db.query(
        `UPDATE open_tasks
            SET status = 'cancelled',
                cancellation_reason = COALESCE($2, cancellation_reason),
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), notes ?? reasonCode],
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
    await db.query(
      `INSERT INTO task_activity_log
         (task_id, event_type, performed_by, old_value, new_value, reason, reference_id, created_at)
       VALUES ($1, 'status_change', $2, $3, $4, $5, $6, NOW())`,
      [
        Number(vt.open_task_id),
        performedByUserId,
        String(vt.open_task_status ?? ''),
        openTaskNewStatus,
        decision,
        visitTaskResultId,
      ],
    );

    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);
    if (!useExternal) await db.query('COMMIT');

    return {
      visitTaskResultId,
      deviceCheckupResultId,
      technicalStateId,
      openTaskNewStatus,
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
// Records "تسديد ذمة" outcomes for the existing installment_collection task.
// One result targets one contract_installments row. Partial payment and
// reschedule close the current task and spawn a fresh collection task for the
// same installment after the current task is terminal.
// ════════════════════════════════════════════════════════════════
export async function applyDeviceReturnResult(
  visitTaskId: number,
  body: DeviceReturnResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<DeviceReturnReflectionResult> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();

  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status, fv.scheduled_date AS visit_date,
              ot.id AS open_task_id, ot.status AS open_task_status, ot.device_id,
              idev.status AS device_status,
              retr.retrieval_task_id,
              retr.pre_retrieval_branch_id,
              retr.pre_retrieval_geo_unit_id,
              retr.pre_retrieval_address_text,
              retr.pre_retrieval_lat,
              retr.pre_retrieval_lng
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         JOIN open_tasks ot ON ot.id = vt.source_open_task_id
         JOIN installed_devices idev ON idev.id = ot.device_id
         LEFT JOIN LATERAL (
           SELECT otret.id AS retrieval_task_id,
                  otret.pre_retrieval_branch_id,
                  otret.pre_retrieval_geo_unit_id,
                  otret.pre_retrieval_address_text,
                  otret.pre_retrieval_lat,
                  otret.pre_retrieval_lng
             FROM open_tasks otret
             JOIN visit_tasks vtret ON vtret.source_open_task_id = otret.id
             JOIN visit_task_results vtr ON vtr.visit_task_id = vtret.id
             JOIN visit_task_device_retrieval_results rr ON rr.visit_task_result_id = vtr.id
            WHERE otret.device_id = ot.device_id
              AND otret.task_type = 'device_retrieval'
              AND vtr.final_decision = 'retrieved_successfully'
              AND rr.retrieval_purpose = 'maintenance'
            ORDER BY vtr.closed_at DESC NULLS LAST, vtr.id DESC
            LIMIT 1
         ) retr ON TRUE
        WHERE vt.id = $1
        LIMIT 1
        FOR UPDATE OF vt, ot, idev`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير مرتبط بمهمة إرجاع جهاز');

    const vt = vtRows[0];
    if (vt.task_type !== 'device_return') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" - هذا المسار خاص بإرجاع الجهاز فقط`);
    }
    if (!isPositiveInteger(vt.device_id)) {
      throw new ResultValidationError('مهمة إرجاع الجهاز يجب أن ترتبط بجهاز مثبت');
    }
    if (vt.device_status !== 'in_workshop') {
      throw new ResultValidationError('لا يمكن تسجيل إرجاع إلا لجهاز حالته in_workshop');
    }
    if (!vt.retrieval_task_id) {
      throw new ResultValidationError('لا يمكن تسجيل إرجاع قبل وجود سحب صيانة ناجح للجهاز');
    }
    if (!vt.pre_retrieval_geo_unit_id || !optionalText(vt.pre_retrieval_address_text)) {
      throw new ResultValidationError('عنوان التركيب السابق قبل السحب غير محفوظ ولا يمكن إرجاع الجهاز بدونه');
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة - الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`المهمة في حالة "${vt.status}" ولا تقبل تسجيل نتيجة جديدة`);
    }

    const shape = assertReturnShape(body);
    let refusalReasonId: number | null = null;
    let rescheduleReasonId: number | null = null;

    if (shape.decision === 'customer_refused_return') {
      refusalReasonId = await assertSystemListCategory(
        db,
        body.refusal_reason_id,
        'device_return_refusal_reasons',
        'سبب رفض إرجاع الجهاز',
      );
    }
    if (shape.decision === 'reschedule') {
      rescheduleReasonId = await assertSystemListCategory(
        db,
        body.reschedule_reason_id,
        'device_return_reschedule_reasons',
        'سبب إعادة جدولة إرجاع الجهاز',
      );
    }

    const notes = body.closing_notes ?? body.notes ?? null;
    const reasonCode =
      refusalReasonId != null ? String(refusalReasonId)
      : rescheduleReasonId != null ? String(rescheduleReasonId)
      : 'device_return_after_maintenance';

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
      [visitTaskId, shape.decision, reasonCode, notes, performedByUserId],
    );
    const visitTaskResultId = Number(vtrRows[0].id);

    const actualReturnDate =
      optionalDate(body.actual_return_date)
      ?? optionalDate(vt.visit_date)
      ?? new Date().toISOString().slice(0, 10);

    const { rows: returnRows } = await db.query(
      `INSERT INTO visit_task_device_return_results
         (visit_task_result_id, final_decision, source_retrieval_task_id,
          restored_branch_id, restored_geo_unit_id, restored_address_text,
          restored_lat, restored_lng, actual_return_date,
          refusal_reason_id, reschedule_reason_id, rescheduled_at,
          customer_acknowledged, technical_notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12::date,$13,$14,NOW(),NOW())
       ON CONFLICT (visit_task_result_id) DO UPDATE SET
          final_decision = EXCLUDED.final_decision,
          source_retrieval_task_id = EXCLUDED.source_retrieval_task_id,
          restored_branch_id = EXCLUDED.restored_branch_id,
          restored_geo_unit_id = EXCLUDED.restored_geo_unit_id,
          restored_address_text = EXCLUDED.restored_address_text,
          restored_lat = EXCLUDED.restored_lat,
          restored_lng = EXCLUDED.restored_lng,
          actual_return_date = EXCLUDED.actual_return_date,
          refusal_reason_id = EXCLUDED.refusal_reason_id,
          reschedule_reason_id = EXCLUDED.reschedule_reason_id,
          rescheduled_at = EXCLUDED.rescheduled_at,
          customer_acknowledged = EXCLUDED.customer_acknowledged,
          technical_notes = EXCLUDED.technical_notes,
          updated_at = NOW()
       RETURNING id`,
      [
        visitTaskResultId,
        shape.decision,
        Number(vt.retrieval_task_id),
        vt.pre_retrieval_branch_id ?? null,
        vt.pre_retrieval_geo_unit_id ?? null,
        vt.pre_retrieval_address_text ?? null,
        vt.pre_retrieval_lat == null ? null : Number(vt.pre_retrieval_lat),
        vt.pre_retrieval_lng == null ? null : Number(vt.pre_retrieval_lng),
        shape.decision === 'returned_successfully' ? actualReturnDate : null,
        refusalReasonId,
        rescheduleReasonId,
        optionalDate(body.expected_date),
        body.customer_acknowledged === true ? true : (body.customer_acknowledged === false ? false : null),
        optionalText(body.technical_notes),
      ],
    );
    const deviceReturnResultId = Number(returnRows[0].id);

    if (shape.deviceNewStatus === 'delivered') {
      await db.query(
        `UPDATE installed_devices
            SET status = 'delivered',
                branch_id = COALESCE($2, branch_id),
                installation_geo_unit_id = $3,
                installation_address_text = $4,
                installation_lat = $5,
                installation_lng = $6,
                delivery_date = COALESCE($7::date, delivery_date),
                updated_at = NOW()
          WHERE id = $1`,
        [
          Number(vt.device_id),
          vt.pre_retrieval_branch_id ?? null,
          vt.pre_retrieval_geo_unit_id,
          vt.pre_retrieval_address_text,
          vt.pre_retrieval_lat == null ? null : Number(vt.pre_retrieval_lat),
          vt.pre_retrieval_lng == null ? null : Number(vt.pre_retrieval_lng),
          actualReturnDate,
        ],
      );
    }

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
                expected_time = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), optionalDate(body.expected_date), optionalText(body.expected_time)],
      );
    } else if (shape.openTaskNewStatus === 'cancelled') {
      await db.query(
        `UPDATE open_tasks
            SET status = 'cancelled',
                cancellation_reason = COALESCE($2, cancellation_reason),
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), notes ?? reasonCode],
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

    await db.query(
      `INSERT INTO task_activity_log
         (task_id, event_type, performed_by, old_value, new_value, reason, reference_id, created_at)
       VALUES ($1, 'status_change', $2, $3, $4, $5, $6, NOW())`,
      [
        Number(vt.open_task_id),
        performedByUserId,
        String(vt.open_task_status ?? ''),
        shape.openTaskNewStatus,
        shape.decision,
        visitTaskResultId,
      ],
    );

    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);

    if (!useExternal) await db.query('COMMIT');

    return {
      visitTaskResultId,
      deviceReturnResultId,
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

export async function applyDeviceTransferResult(
  visitTaskId: number,
  body: DeviceTransferResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<DeviceTransferReflectionResult> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();

  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status,
              ot.id AS open_task_id, ot.status AS open_task_status, ot.device_id,
              ot.client_id AS from_client_id,
              ot.transfer_kind, ot.target_client_id,
              ot.planned_transfer_geo_unit_id, ot.planned_transfer_address_text,
              ot.planned_transfer_lat, ot.planned_transfer_lng,
              idev.status AS device_status,
              idev.customer_id AS current_customer_id,
              idev.branch_id AS current_device_branch_id,
              gu.level AS planned_geo_level,
              gu.status AS planned_geo_status,
              target.id AS target_client_exists,
              target.branch_id AS target_client_branch_id
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         JOIN open_tasks ot ON ot.id = vt.source_open_task_id
         JOIN installed_devices idev ON idev.id = ot.device_id
         LEFT JOIN geo_units gu ON gu.id = ot.planned_transfer_geo_unit_id
         LEFT JOIN clients target ON target.id = ot.target_client_id
        WHERE vt.id = $1
        LIMIT 1
        FOR UPDATE OF vt, ot, idev`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير مرتبط بمهمة نقل جهاز');

    const vt = vtRows[0];
    if (vt.task_type !== 'device_transfer') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" - هذا المسار خاص بنقل الجهاز فقط`);
    }
    if (!isPositiveInteger(vt.device_id)) {
      throw new ResultValidationError('مهمة نقل الجهاز يجب أن ترتبط بجهاز مثبت');
    }
    if (!['delivered', 'installed', 'active'].includes(String(vt.device_status))) {
      throw new ResultValidationError('لا يمكن نقل الجهاز إلا عندما يكون عند الزبون');
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة - الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`المهمة في حالة "${vt.status}" ولا تقبل تسجيل نتيجة جديدة`);
    }

    const shape = assertTransferShape(body, vt);

    const { rows: geoRows } = await db.query(
      `SELECT id, level, status
         FROM geo_units
        WHERE id = $1
        LIMIT 1`,
      [shape.plannedGeoUnitId],
    );
    if (!geoRows[0]) {
      throw new ResultValidationError('الحي المحدد في العنوان المبدئي غير موجود');
    }
    if (Number(geoRows[0].level) !== 4) {
      throw new ResultValidationError('العنوان المبدئي يجب أن يحدد الحي حصراً');
    }
    if (geoRows[0].status === 'inactive') {
      throw new ResultValidationError('لا يمكن اختيار حي موقوف');
    }

    if (shape.transferKind === 'another_customer') {
      const { rows: targetRows } = await db.query(
        `SELECT id, branch_id
           FROM clients
          WHERE id = $1
          LIMIT 1`,
        [shape.targetClientId],
      );
      if (!targetRows[0]) {
        throw new ResultValidationError('الزبون الجديد غير موجود');
      }
      if (Number(targetRows[0].id) === Number(vt.from_client_id)) {
        throw new ResultValidationError('الزبون الجديد يجب أن يختلف عن الزبون الحالي عند نقل الملكية');
      }
    }

    let refusalReasonId: number | null = null;
    let rescheduleReasonId: number | null = null;

    if (shape.decision === 'customer_refused_transfer') {
      refusalReasonId = await assertSystemListCategory(
        db,
        body.refusal_reason_id,
        'device_transfer_refusal_reasons',
        'سبب رفض نقل الجهاز',
      );
    }
    if (shape.decision === 'reschedule') {
      rescheduleReasonId = await assertSystemListCategory(
        db,
        body.reschedule_reason_id,
        'device_transfer_reschedule_reasons',
        'سبب إعادة جدولة نقل الجهاز',
      );
    }

    const notes = body.closing_notes ?? body.notes ?? null;
    const reasonCode =
      refusalReasonId != null ? String(refusalReasonId)
      : rescheduleReasonId != null ? String(rescheduleReasonId)
      : shape.transferKind;

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
      [visitTaskId, shape.decision, reasonCode, notes, performedByUserId],
    );
    const visitTaskResultId = Number(vtrRows[0].id);

    const ownershipTransferred = shape.decision === 'transferred_successfully' && shape.transferKind === 'another_customer';
    const toClientId = shape.transferKind === 'another_customer' ? shape.targetClientId : Number(vt.from_client_id);

    const { rows: transferRows } = await db.query(
      `INSERT INTO visit_task_device_transfer_results
         (visit_task_result_id, final_decision, transfer_kind,
          from_client_id, to_client_id, ownership_transferred,
          planned_geo_unit_id, planned_address_text, planned_lat, planned_lng,
          refusal_reason_id, reschedule_reason_id, rescheduled_at,
          customer_acknowledged, target_customer_acknowledged, technical_notes,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14,$15,$16,NOW(),NOW())
       ON CONFLICT (visit_task_result_id) DO UPDATE SET
          final_decision = EXCLUDED.final_decision,
          transfer_kind = EXCLUDED.transfer_kind,
          from_client_id = EXCLUDED.from_client_id,
          to_client_id = EXCLUDED.to_client_id,
          ownership_transferred = EXCLUDED.ownership_transferred,
          planned_geo_unit_id = EXCLUDED.planned_geo_unit_id,
          planned_address_text = EXCLUDED.planned_address_text,
          planned_lat = EXCLUDED.planned_lat,
          planned_lng = EXCLUDED.planned_lng,
          refusal_reason_id = EXCLUDED.refusal_reason_id,
          reschedule_reason_id = EXCLUDED.reschedule_reason_id,
          rescheduled_at = EXCLUDED.rescheduled_at,
          customer_acknowledged = EXCLUDED.customer_acknowledged,
          target_customer_acknowledged = EXCLUDED.target_customer_acknowledged,
          technical_notes = EXCLUDED.technical_notes,
          updated_at = NOW()
       RETURNING id`,
      [
        visitTaskResultId,
        shape.decision,
        shape.transferKind,
        Number(vt.from_client_id),
        toClientId,
        ownershipTransferred,
        shape.plannedGeoUnitId,
        shape.plannedAddressText,
        shape.plannedLat,
        shape.plannedLng,
        refusalReasonId,
        rescheduleReasonId,
        optionalDate(body.expected_date),
        body.customer_acknowledged === true ? true : (body.customer_acknowledged === false ? false : null),
        body.target_customer_acknowledged === true ? true : (body.target_customer_acknowledged === false ? false : null),
        optionalText(body.technical_notes),
      ],
    );
    const deviceTransferResultId = Number(transferRows[0].id);

    if (shape.decision === 'transferred_successfully') {
      await db.query(
        `UPDATE installed_devices
            SET status = 'delivered',
                customer_id = $2,
                branch_id = COALESCE($3, branch_id),
                installation_geo_unit_id = $4,
                installation_address_text = $5,
                installation_lat = $6,
                installation_lng = $7,
                updated_at = NOW()
          WHERE id = $1`,
        [
          Number(vt.device_id),
          toClientId,
          ownershipTransferred ? (vt.target_client_branch_id ?? vt.current_device_branch_id ?? null) : vt.current_device_branch_id ?? null,
          shape.plannedGeoUnitId,
          shape.plannedAddressText,
          shape.plannedLat,
          shape.plannedLng,
        ],
      );

      if (ownershipTransferred) {
        const employeeId = await resolveEmployeeIdForUser(db, performedByUserId);
        await db.query(
          `UPDATE device_possession_log
              SET end_at = NOW()
            WHERE device_id = $1
              AND end_at IS NULL`,
          [Number(vt.device_id)],
        );
        await db.query(
          `INSERT INTO device_possession_log
             (device_id, holder_type, holder_id, start_at, reason, notes, created_by)
           VALUES ($1, 'customer', $2, NOW(), 'transfer', $3, $4)`,
          [
            Number(vt.device_id),
            toClientId,
            notes ?? 'نقل ملكية الجهاز إلى زبون آخر',
            employeeId,
          ],
        );
      }
    }

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
                expected_time = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), optionalDate(body.expected_date), optionalText(body.expected_time)],
      );
    } else if (shape.openTaskNewStatus === 'cancelled') {
      await db.query(
        `UPDATE open_tasks
            SET status = 'cancelled',
                cancellation_reason = COALESCE($2, cancellation_reason),
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), notes ?? reasonCode],
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

    await db.query(
      `INSERT INTO task_activity_log
         (task_id, event_type, performed_by, old_value, new_value, reason, reference_id, created_at)
       VALUES ($1, 'status_change', $2, $3, $4, $5, $6, NOW())`,
      [
        Number(vt.open_task_id),
        performedByUserId,
        String(vt.open_task_status ?? ''),
        shape.openTaskNewStatus,
        shape.decision,
        visitTaskResultId,
      ],
    );

    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);

    if (!useExternal) await db.query('COMMIT');

    return {
      visitTaskResultId,
      deviceTransferResultId,
      openTaskNewStatus: shape.openTaskNewStatus,
      deviceNewStatus: shape.deviceNewStatus,
      ownershipTransferred,
      visitCompleted: completion.completed,
    };
  } catch (err) {
    if (!useExternal) await db.query('ROLLBACK');
    throw err;
  } finally {
    if (!useExternal) (db as PoolClient).release();
  }
}

export async function applyInstallmentCollectionResult(
  visitTaskId: number,
  body: InstallmentCollectionResultBody,
  performedByUserId: number,
  externalDb?: PoolClient,
): Promise<InstallmentCollectionReflectionResult> {
  const useExternal = externalDb != null;
  const db = useExternal ? (externalDb as PoolClient) : await pool.connect();

  try {
    if (!useExternal) await db.query('BEGIN');

    const { rows: vtRows } = await db.query(
      `SELECT vt.id, vt.field_visit_id, vt.source_open_task_id, vt.task_type, vt.status,
              fv.status AS visit_status,
              ot.id AS open_task_id, ot.installment_id, ot.contract_id, ot.branch_id,
              ot.status AS open_task_status,
              ot.receivable_source_type, ot.receivable_source_id, ot.receivable_source_label,
              i.remaining_balance, i.amount_syp, i.contract_id AS installment_contract_id
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         JOIN open_tasks ot ON ot.id = vt.source_open_task_id
         JOIN contract_installments i ON i.id = ot.installment_id
        WHERE vt.id = $1
        LIMIT 1
        FOR UPDATE OF vt, ot, i`,
      [visitTaskId],
    );
    if (vtRows.length === 0) throw new ResultValidationError('visit_task غير مرتبط بمهمة تسديد ذمة');

    const vt = vtRows[0];
    if (vt.task_type !== 'installment_collection') {
      throw new ResultValidationError(`نوع المهمة "${vt.task_type}" - هذا المسار خاص بتسديد الذمم فقط`);
    }
    if (!['in_progress', 'ended', 'completed'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة - الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(vt.status)) {
      throw new ResultValidationError(`المهمة في حالة "${vt.status}" ولا تقبل تسجيل نتيجة جديدة`);
    }

    const decision = body.final_decision;
    if (!['paid_full', 'paid_partial', 'rescheduled', 'refused_to_pay'].includes(decision)) {
      throw new ResultValidationError(`final_decision غير صالح: ${decision}`);
    }

    const amountBefore = Number(vt.remaining_balance) || 0;
    if (amountBefore <= 0) {
      throw new ResultValidationError('القسط المحدد لا يملك رصيداً مفتوحاً للتحصيل');
    }

    const notes = body.closing_notes ?? null;
    const nextExpectedDate = optionalDate(body.next_expected_date);
    const nextPriority = normalizePriority(body.next_priority);
    const parts = Array.isArray(body.payment_parts) ? body.payment_parts : [];
    const usingParts = parts.length > 0;
    let paidAmount = optionalNumber(body.paid_amount_syp);
    let partialReasonId: number | null = null;
    let rescheduleReasonId: number | null = null;
    let refusalReasonId: number | null = null;

    if (decision === 'paid_full' || decision === 'paid_partial') {
      if (usingParts) {
        // كل جزء دفع يجب أن يكون مكتملاً قبل قبول الدفعة.
        for (const p of parts) {
          if (!['hand', 'transfer', 'barter'].includes(p.method)) {
            throw new ResultValidationError('نوع جزء الدفع غير صالح');
          }
          if (!(Number(p.amountValue) > 0)) {
            throw new ResultValidationError('قيمة كل جزء دفع مطلوبة');
          }
          if (p.method === 'barter' && !optionalText(p.barterDescription)) {
            throw new ResultValidationError('وصف المقايضة مطلوب');
          }
          if (p.method !== 'barter' && p.currency === 'usd' && !(Number(p.exchangeRate) > 0)) {
            throw new ResultValidationError('سعر الصرف مطلوب للدفع بالدولار');
          }
        }
        paidAmount = parts.reduce((sum, p) => sum + collectionPartSyp(p), 0);
      }
      if (!paidAmount || paidAmount <= 0) {
        throw new ResultValidationError('قيمة الدفعة مطلوبة');
      }
      if (!usingParts && !optionalText(body.payment_method)) {
        throw new ResultValidationError('طريقة الدفع مطلوبة');
      }
      if (decision === 'paid_full' && paidAmount + 0.5 < amountBefore) {
        throw new ResultValidationError('الدفع الكامل يجب أن يغطي كامل الرصيد المتبقي');
      }
      if (decision === 'paid_partial') {
        if (paidAmount >= amountBefore) {
          throw new ResultValidationError('الدفع الجزئي يجب أن يكون أقل من الرصيد المتبقي');
        }
        partialReasonId = await assertSystemListCategory(
          db,
          body.partial_payment_reason_id,
          'collection_partial_payment_reasons',
          'سبب الدفعة الجزئية',
        );
        if (!nextExpectedDate) throw new ResultValidationError('تاريخ المتابعة مطلوب عند الدفعة الجزئية');
        if (!nextPriority) throw new ResultValidationError('أولوية المهمة الجديدة مطلوبة عند الدفعة الجزئية');
      }
    } else {
      paidAmount = null;
    }

    if (decision === 'rescheduled') {
      rescheduleReasonId = await assertSystemListCategory(
        db,
        body.reschedule_reason_id,
        'collection_reschedule_reasons',
        'سبب إعادة الجدولة',
      );
      if (!nextExpectedDate) throw new ResultValidationError('تاريخ المتابعة مطلوب عند إعادة الجدولة');
      if (!nextPriority) throw new ResultValidationError('أولوية المهمة الجديدة مطلوبة عند إعادة الجدولة');
    }

    if (decision === 'refused_to_pay') {
      refusalReasonId = await assertSystemListCategory(
        db,
        body.refusal_reason_id,
        'collection_refusal_reasons',
        'سبب رفض الدفع',
      );
    }

    const reasonCode =
      partialReasonId != null ? String(partialReasonId)
      : rescheduleReasonId != null ? String(rescheduleReasonId)
      : refusalReasonId != null ? String(refusalReasonId)
      : null;

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
      [visitTaskId, decision, reasonCode, notes, performedByUserId],
    );
    const visitTaskResultId = Number(vtrRows[0].id);

    const paymentContractId = Number(vt.installment_contract_id ?? vt.contract_id);
    const receivedByEmployeeId = isPositiveInteger(body.received_by_employee_id)
      ? Number(body.received_by_employee_id)
      : performedByUserId;
    let paymentEntryId: number | null = null;
    if (paidAmount != null) {
      if (usingParts) {
        // صف دفعة لكل جزء (يد/حوالة/مقايضة، بالليرة أو الدولار)، الكل مرتبط بالقسط.
        for (const p of parts) {
          const partSyp = collectionPartSyp(p);
          const { rows: pr } = await db.query(
            `INSERT INTO contract_payment_entries (
               contract_id, method, currency, amount_value, exchange_rate, amount_syp,
               reference_number, barter_name, barter_value_syp,
               received_by_employee_id, notes, entry_type, installment_id
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'collection',$12)
             RETURNING id`,
            [
              paymentContractId,
              p.method,
              p.method === 'barter' ? 'SYP' : (p.currency === 'usd' ? 'USD' : 'SYP'),
              Number(p.amountValue),
              p.method !== 'barter' && p.currency === 'usd' ? Number(p.exchangeRate) : null,
              partSyp,
              p.method === 'transfer' && p.transferCompanyId != null
                ? String(p.transferCompanyId)
                : optionalText(body.payment_reference),
              p.method === 'barter' ? optionalText(p.barterDescription) : null,
              p.method === 'barter' ? partSyp : null,
              receivedByEmployeeId,
              notes,
              Number(vt.installment_id),
            ],
          );
          const id = Number(pr[0].id);
          if (paymentEntryId == null) paymentEntryId = id;
          await recordContractPaymentMovement(db, id, performedByUserId);
        }
        await db.query('SELECT recompute_installment_balance($1)', [Number(vt.installment_id)]);
      } else {
        const method = optionalText(body.payment_method)!;
        const { rows: paymentRows } = await db.query(
          `INSERT INTO contract_payment_entries (
             contract_id, method, currency, amount_value, amount_syp,
             reference_number, received_by_employee_id, notes, entry_type, installment_id
           ) VALUES ($1, $2, 'SYP', $3, $3, $4, $5, $6, 'collection', $7)
           RETURNING id`,
          [
            paymentContractId,
            method,
            paidAmount,
            optionalText(body.payment_reference),
            receivedByEmployeeId,
            notes,
            Number(vt.installment_id),
          ],
        );
        paymentEntryId = Number(paymentRows[0].id);
        await db.query('SELECT recompute_installment_balance($1)', [Number(vt.installment_id)]);
        // سجل الحركات المالية: دفعة تحصيل القسط.
        await recordContractPaymentMovement(db, paymentEntryId, performedByUserId);
      }
    }

    const { rows: afterRows } = await db.query(
      `SELECT remaining_balance
         FROM contract_installments
        WHERE id = $1
        LIMIT 1`,
      [Number(vt.installment_id)],
    );
    const remainingAfter = Number(afterRows[0]?.remaining_balance ?? amountBefore);

    const openTaskNewStatus = decision === 'refused_to_pay' ? 'cancelled' : 'completed';
    await db.query(
      `UPDATE visit_tasks
          SET status = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [decision === 'refused_to_pay' ? 'cancelled' : 'completed', visitTaskId],
    );

    if (decision === 'refused_to_pay') {
      await db.query(
        `UPDATE open_tasks
            SET status = 'cancelled',
                cancellation_reason = COALESCE($2, cancellation_reason),
                updated_at = NOW()
          WHERE id = $1`,
        [Number(vt.open_task_id), notes ?? 'refused_to_pay'],
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

    await db.query(
      `INSERT INTO task_activity_log
         (task_id, event_type, performed_by, old_value, new_value, reason, reference_id, created_at)
       VALUES ($1, 'status_change', $2, $3, $4, $5, $6, NOW())`,
      [
        Number(vt.open_task_id),
        performedByUserId,
        String(vt.open_task_status ?? ''),
        openTaskNewStatus,
        decision,
        visitTaskResultId,
      ],
    );

    let createdFollowupTaskId: number | null = null;
    if (decision === 'paid_partial' && remainingAfter > 0) {
      const followup = await createInstallmentCollectionTask(db, {
        installmentId: Number(vt.installment_id),
        dueDate: nextExpectedDate,
        priority: nextPriority,
        reason: 'remaining_installment_balance',
        creationOrigin: 'system_trigger',
        createdBy: performedByUserId,
        sourceContextType: 'collection_result',
        sourceContextId: visitTaskResultId,
        receivableSourceType: vt.receivable_source_type ?? 'contract',
        receivableSourceId: vt.receivable_source_id != null ? Number(vt.receivable_source_id) : Number(vt.contract_id),
        receivableSourceLabel: vt.receivable_source_label ?? null,
      });
      createdFollowupTaskId = followup.taskId;
    }
    if (decision === 'rescheduled') {
      const followup = await createInstallmentCollectionTask(db, {
        installmentId: Number(vt.installment_id),
        dueDate: nextExpectedDate,
        priority: nextPriority,
        reason: 'rescheduled_collection',
        creationOrigin: 'system_trigger',
        createdBy: performedByUserId,
        sourceContextType: 'collection_result',
        sourceContextId: visitTaskResultId,
        receivableSourceType: vt.receivable_source_type ?? 'contract',
        receivableSourceId: vt.receivable_source_id != null ? Number(vt.receivable_source_id) : Number(vt.contract_id),
        receivableSourceLabel: vt.receivable_source_label ?? null,
      });
      createdFollowupTaskId = followup.taskId;
    }

    const { rows: sideRows } = await db.query(
      `INSERT INTO visit_task_installment_collection_results (
         visit_task_result_id, installment_id,
         receivable_source_type, receivable_source_id,
         amount_before_syp, paid_amount_syp, remaining_after_syp,
         payment_entry_id, payment_method, payment_reference, received_by_employee_id,
         partial_payment_reason_id, reschedule_reason_id, refusal_reason_id,
         next_expected_date, next_priority, notes, created_followup_task_id,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::date,$16,$17,$18,NOW(),NOW()
       )
       ON CONFLICT (visit_task_result_id) DO UPDATE SET
         installment_id = EXCLUDED.installment_id,
         receivable_source_type = EXCLUDED.receivable_source_type,
         receivable_source_id = EXCLUDED.receivable_source_id,
         amount_before_syp = EXCLUDED.amount_before_syp,
         paid_amount_syp = EXCLUDED.paid_amount_syp,
         remaining_after_syp = EXCLUDED.remaining_after_syp,
         payment_entry_id = EXCLUDED.payment_entry_id,
         payment_method = EXCLUDED.payment_method,
         payment_reference = EXCLUDED.payment_reference,
         received_by_employee_id = EXCLUDED.received_by_employee_id,
         partial_payment_reason_id = EXCLUDED.partial_payment_reason_id,
         reschedule_reason_id = EXCLUDED.reschedule_reason_id,
         refusal_reason_id = EXCLUDED.refusal_reason_id,
         next_expected_date = EXCLUDED.next_expected_date,
         next_priority = EXCLUDED.next_priority,
         notes = EXCLUDED.notes,
         created_followup_task_id = EXCLUDED.created_followup_task_id,
         updated_at = NOW()
       RETURNING id`,
      [
        visitTaskResultId,
        Number(vt.installment_id),
        vt.receivable_source_type ?? null,
        vt.receivable_source_id != null ? Number(vt.receivable_source_id) : null,
        amountBefore,
        paidAmount,
        remainingAfter,
        paymentEntryId,
        usingParts ? (parts.length > 1 ? 'mixed' : parts[0].method) : optionalText(body.payment_method),
        optionalText(body.payment_reference),
        isPositiveInteger(body.received_by_employee_id) ? Number(body.received_by_employee_id) : (paidAmount != null ? performedByUserId : null),
        partialReasonId,
        rescheduleReasonId,
        refusalReasonId,
        nextExpectedDate,
        nextPriority,
        notes,
        createdFollowupTaskId,
      ],
    );

    const completion = await checkAndCompleteVisit(vt.field_visit_id, performedByUserId, db);

    if (!useExternal) await db.query('COMMIT');

    return {
      visitTaskResultId,
      installmentCollectionResultId: Number(sideRows[0].id),
      openTaskNewStatus,
      paymentEntryId,
      createdFollowupTaskId,
      remainingAfterSyp: remainingAfter,
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
    if (vt.task_type !== 'emergency_maintenance' && vt.task_type !== 'periodic_maintenance') {
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
    if (decision === 'rescheduled') {
      body.reason_code_id = await assertSystemListCategory(
        db,
        body.reason_code_id,
        vt.task_type === 'periodic_maintenance'
          ? 'periodic_maintenance_reschedule_reasons'
          : 'emergency_maintenance_reschedule_reasons',
        'سبب إعادة الجدولة',
      );
    }
    if (decision === 'cancelled' && vt.task_type === 'emergency_maintenance') {
      body.reason_code_id = await assertSystemListCategory(
        db,
        body.reason_code_id,
        'emergency_cancelled_reason',
        'سبب الإلغاء',
      );
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
