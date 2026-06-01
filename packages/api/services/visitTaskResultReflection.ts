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
  customer_response: CustomerResponse;
  /** Free-text refusal reason. Required when customer_response='rejected'. */
  no_closing_reason?: string | null;
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
    if (!['in_progress', 'ended'].includes(vt.visit_status)) {
      throw new ResultValidationError(`لا يمكن تسجيل النتيجة — الزيارة في حالة "${vt.visit_status}"`);
    }
    if (!['pending', 'in_progress'].includes(vt.status)) {
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
      if (!isPositiveNumber(body.closed_by_employee_id)) {
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
       RETURNING id`,
      [
        visitTaskResultId,
        decision === 'device_sold' ? body.offer_type : null,
        decision === 'device_sold' ? body.offer_amount : null,
        decision === 'device_sold' ? (body.installment_months ?? null) : null,
        body.closed_by_employee_id ?? null,
        decision === 'device_sold' ? (body.discount_percentage ?? null) : null,
        decision === 'device_sold' ? (body.sale_reference_number ?? null) : null,
        isDeviceSold,
        decision === 'device_sold' ? body.sold_device_model_id : null,
        body.reason_code_id ?? null,
        body.closing_notes ?? null,
      ],
    );
    const deviceDemoResultId: number = vtdrRows[0].id;

    // ── 5. Insert per-offer rows for offer_presented ───────────
    let acceptedPreOfferId: number | null = null;
    let acceptedOfferData: OfferInput | null = null;

    if (decision === 'offer_presented') {
      // Each offer creates a row in customer_device_pre_offers (customer-level
      // tracking with response_state) plus a row in open_task_pre_offers
      // (open_task-level history). The two are linked via source_customer_pre_offer_id.
      for (const offer of body.offers!) {
        const { rows: cdpoRows } = await db.query(
          `INSERT INTO customer_device_pre_offers
             (customer_id, branch_id, device_model_id, offer_type, quantity,
              total_amount, first_payment_amount, installment_months, currency,
              discount_percentage, applied_device_discount_id,
              closed_by_employee_id, no_closing_reason, response_state,
              created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
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
            offer.customer_response === 'accepted' ? (body.closed_by_employee_id ?? null) : null,
            typeof offer.no_closing_reason === 'string' ? offer.no_closing_reason.trim() || null : null,
            offer.customer_response,
            performedByUserId,
          ],
        );
        const cdpoId = Number(cdpoRows[0].id);

        if (vt.source_open_task_id) {
          await db.query(
            `INSERT INTO open_task_pre_offers
               (open_task_id, device_model_id, offer_type, quantity,
                total_amount, first_payment_amount, installment_months, currency,
                discount_percentage, applied_device_discount_id,
                closed_by_employee_id, no_closing_reason,
                source_customer_pre_offer_id, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())`,
            [
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
              offer.customer_response === 'accepted' ? (body.closed_by_employee_id ?? null) : null,
              typeof offer.no_closing_reason === 'string' ? offer.no_closing_reason.trim() || null : null,
              cdpoId,
            ],
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
        closedByEmployeeId:      body.closed_by_employee_id ?? null,
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

export { ResultValidationError };
