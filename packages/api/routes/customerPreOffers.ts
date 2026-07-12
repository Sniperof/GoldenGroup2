// GET /api/customers/:id/pre-offers
//
// Aggregates every device-demo pre-offer ever prepared for a customer
// together with the outcome of the visit that presented it (if any). The
// view is read-only and exists for strategic planning — the team uses it
// to decide what to propose next, given what the customer already saw
// and how they reacted.
//
// Data sources:
//   • open_task_pre_offers          → the prepared offer (price, terms, …)
//   • open_tasks                    → parent device_demo task
//   • visit_tasks  (latest one per source_open_task_id)
//   • visit_task_results            → final_decision code
//   • visit_task_device_demo_results→ contract_id if a sale happened
//   • contracts                     → device_model_id of the signed contract
//                                      (used to disambiguate "accepted" vs
//                                      "not chosen" when the task carried
//                                      multiple pre-offers — product decision).
//
// Outcome state machine:
//   not_presented_yet → no visit_task_result is linked yet.
//   needs_follow_up   → the visit completed but the customer postponed.
//   accepted          → a contract was signed AND its device matches this offer.
//   not_chosen        → a contract was signed but on a DIFFERENT device.
//   rejected          → visit happened, no contract, not postponed.

import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  catalogUnavailablePayload,
  findUnavailableDeviceModelsForNewCommercialUse,
} from '../services/catalogActiveStateService.js';

const router = Router();
router.use(requireAuth);

function toPositiveNumber(value: any): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toPositiveInteger(value: any): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

router.get(
  '/:id/pre-offers',
  requirePermission('clients.pre_offers.view', 'contracts.view_list'),
  async (req, res) => {
    const customerId = Number(req.params.id);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'customerId غير صالح' });
    }

    const sql = `
      WITH latest_visit AS (
        -- For each device_demo open_task, keep the most recent visit_task row.
        -- DISTINCT ON is the idiomatic PG pattern for "first per partition".
        SELECT DISTINCT ON (vt.source_open_task_id)
          vt.source_open_task_id  AS open_task_id,
          vt.id                   AS visit_task_id,
          vt.updated_at           AS visit_updated_at
        FROM visit_tasks vt
        WHERE vt.task_type = 'device_demo'
        ORDER BY vt.source_open_task_id, vt.updated_at DESC
      ),
      task_offers AS (
      SELECT
        'task'::text                 AS source_kind,
        po.id                       AS pre_offer_id,
        po.source_customer_pre_offer_id AS customer_pre_offer_id,
        ot.id                       AS open_task_id,
        ot.status                   AS task_status,
        ot.created_at               AS task_created_at,
        ot.due_date                 AS task_due_date,
        po.device_model_id          AS device_model_id,
        COALESCE(dm.name_ar, dm.name) AS device_model_name,
        po.offer_type               AS offer_type,
        po.currency                 AS currency,
        po.quantity                 AS quantity,
        po.total_amount::float      AS total_amount,
        po.first_payment_amount::float AS first_payment_amount,
        po.installment_months       AS installment_months,
        po.discount_percentage::float AS discount_percentage,
        po.applied_device_discount_id AS applied_device_discount_id,
        po.closed_by_employee_id    AS closed_by_employee_id,
        prep.name                   AS closed_by_employee_name,
        po.no_closing_reason        AS no_closing_reason,
        COALESCE(po.sale_reference_number, linked_spo.sale_reference_number) AS sale_reference_number,
        linked_spo.response_state   AS linked_response_state,

        vtr.id                      AS visit_task_result_id,
        vtr.final_decision          AS final_decision_code,
        vtr.closed_at               AS visit_closed_at,
        vtr.closed_by               AS visit_closed_by_id,
        visit_closer.name           AS visit_closed_by_name,
        vtddr.offer_amount::float   AS actual_offer_amount,
        COALESCE(vtddr.contract_id, linked_contract.id) AS contract_id,
        COALESCE(c.contract_number, linked_contract.contract_number) AS contract_number,
        COALESCE(c.device_model_id, linked_contract.device_model_id) AS contract_device_model_id

      FROM open_task_pre_offers po
      JOIN open_tasks ot ON ot.id = po.open_task_id
      LEFT JOIN device_models dm ON dm.id = po.device_model_id
      LEFT JOIN employees prep ON prep.id = po.closed_by_employee_id
      LEFT JOIN customer_device_pre_offers linked_spo ON linked_spo.id = po.source_customer_pre_offer_id

      LEFT JOIN latest_visit lv ON lv.open_task_id = ot.id
      LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = lv.visit_task_id
      LEFT JOIN visit_task_device_demo_results vtddr ON vtddr.visit_task_result_id = vtr.id
      LEFT JOIN employees visit_closer ON visit_closer.id = vtr.closed_by
      LEFT JOIN contracts c ON c.id = vtddr.contract_id
      LEFT JOIN LATERAL (
        SELECT cx.id, cx.contract_number, cx.device_model_id
          FROM contracts cx
         WHERE cx.customer_id = ot.client_id
           AND (
             cx.source_task_offer_id = po.id
             OR (
               COALESCE(po.sale_reference_number, linked_spo.sale_reference_number) IS NOT NULL
               AND cx.sale_reference_number = COALESCE(po.sale_reference_number, linked_spo.sale_reference_number)
             )
           )
         ORDER BY cx.id DESC
         LIMIT 1
      ) linked_contract ON true

      WHERE ot.client_id = $1
        AND ot.task_type = 'device_demo'
      ),
      standalone_offers AS (
      SELECT
        'standalone'::text           AS source_kind,
        NULL::bigint                 AS pre_offer_id,
        spo.id                       AS customer_pre_offer_id,
        NULL::integer                AS open_task_id,
        NULL::varchar                AS task_status,
        spo.created_at               AS task_created_at,
        NULL::date                   AS task_due_date,
        spo.device_model_id          AS device_model_id,
        COALESCE(dm.name_ar, dm.name) AS device_model_name,
        spo.offer_type               AS offer_type,
        spo.currency                 AS currency,
        spo.quantity                 AS quantity,
        spo.total_amount::float      AS total_amount,
        spo.first_payment_amount::float AS first_payment_amount,
        spo.installment_months       AS installment_months,
        spo.discount_percentage::float AS discount_percentage,
        spo.applied_device_discount_id AS applied_device_discount_id,
        spo.closed_by_employee_id    AS closed_by_employee_id,
        prep.name                    AS closed_by_employee_name,
        spo.no_closing_reason        AS no_closing_reason,
        spo.sale_reference_number    AS sale_reference_number,
        spo.response_state           AS linked_response_state,
        NULL::integer                AS visit_task_result_id,
        CASE
          WHEN spo.response_state = 'extension_requested' THEN 'needs_followup'
          WHEN spo.response_state IN ('accepted', 'rejected') THEN spo.response_state
          ELSE NULL
        END                          AS final_decision_code,
        NULL::timestamptz            AS visit_closed_at,
        NULL::integer                AS visit_closed_by_id,
        NULL::text                   AS visit_closed_by_name,
        NULL::float                  AS actual_offer_amount,
        NULL::integer                AS contract_id,
        NULL::varchar                AS contract_number,
        NULL::integer                AS contract_device_model_id
      FROM customer_device_pre_offers spo
      LEFT JOIN device_models dm ON dm.id = spo.device_model_id
      LEFT JOIN employees prep ON prep.id = spo.closed_by_employee_id
      WHERE spo.customer_id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM open_task_pre_offers linked
          WHERE linked.source_customer_pre_offer_id = spo.id
        )
      )
      SELECT * FROM task_offers
      UNION ALL
      SELECT * FROM standalone_offers
      ORDER BY task_created_at DESC NULLS LAST, pre_offer_id DESC NULLS LAST, customer_pre_offer_id DESC NULLS LAST
    `;

    const { rows } = await pool.query(sql, [customerId]);

    function resolveOutcome(r: any): string {
      // (1) No visit_task_result row → never presented.
      if (r.source_kind === 'standalone' && r.final_decision_code === 'needs_followup') return 'needs_follow_up';
      if (r.source_kind === 'standalone' && ['accepted', 'rejected'].includes(r.final_decision_code)) return r.final_decision_code;
      if (r.source_kind === 'task' && r.linked_response_state === 'extension_requested') return 'needs_follow_up';
      if (r.source_kind === 'task' && ['accepted', 'rejected'].includes(r.linked_response_state)) return r.linked_response_state;
      if (!r.visit_task_result_id) return 'not_presented_yet';

      // (2) Contract was signed inside this task → branch on the device.
      //     (Product decision: a multi-offer task with a single contract
      //      marks the matched offer as accepted, the rest as not_chosen.)
      if (r.contract_id) {
        return r.contract_device_model_id === r.device_model_id ? 'accepted' : 'not_chosen';
      }

      // (3) Visit closed with a "needs_followup" decision, or the parent
      //     open_task is still flagged needs_follow_up → pending follow-up.
      if (r.final_decision_code === 'needs_followup'
          || r.task_status === 'needs_follow_up') {
        return 'needs_follow_up';
      }

      // (4) Anything else past this point — visit happened, no contract,
      //     no follow-up flag — counts as rejected for planning purposes.
      return 'rejected';
    }

    const entries = rows.map(r => {
      const outcomeState = resolveOutcome(r);
      return {
        sourceKind:              r.source_kind,
        preOfferId:              r.pre_offer_id == null ? null : Number(r.pre_offer_id),
        customerPreOfferId:      r.customer_pre_offer_id == null ? null : Number(r.customer_pre_offer_id),
        openTaskId:              r.open_task_id,
        taskStatus:              r.task_status,
        taskCreatedAt:           r.task_created_at,
        taskDueDate:             r.task_due_date,
        deviceModelId:           r.device_model_id,
        deviceModelName:         r.device_model_name,
        offerType:               r.offer_type,
        currency:                r.currency,
        quantity:                r.quantity,
        totalAmount:             r.total_amount,
        firstPaymentAmount:      r.first_payment_amount,
        installmentMonths:       r.installment_months,
        discountPercentage:      r.discount_percentage,
        appliedDeviceDiscountId: r.applied_device_discount_id,
        closedByEmployeeId:      r.closed_by_employee_id,
        closedByEmployeeName:    r.closed_by_employee_name,
        noClosingReason:         r.no_closing_reason,
        saleReferenceNumber:     r.sale_reference_number,
        outcome: {
          state:                 outcomeState,
          visitTaskResultId:     r.visit_task_result_id,
          finalDecisionCode:     r.final_decision_code,
          closedAt:              r.visit_closed_at,
          closedByEmployeeId:    r.visit_closed_by_id,
          closedByEmployeeName:  r.visit_closed_by_name,
          actualOfferAmount:     r.actual_offer_amount,
          contractId:            r.contract_id,
          contractNumber:        r.contract_number,
        },
      };
    });

    // Summary buckets — driven by the same state machine so the chips and
    // the table can't drift.
    const summary = entries.reduce(
      (acc, e) => {
        acc.total += 1;
        switch (e.outcome.state) {
          case 'not_presented_yet': acc.notPresentedYet += 1; break;
          case 'needs_follow_up':   acc.needsFollowUp   += 1; break;
          case 'accepted':          acc.accepted        += 1; break;
          case 'not_chosen':        acc.notChosen       += 1; break;
          case 'rejected':          acc.rejected        += 1; break;
        }
        return acc;
      },
      { total: 0, notPresentedYet: 0, needsFollowUp: 0, accepted: 0, notChosen: 0, rejected: 0 },
    );

    res.json({ customerId, entries, summary });
  },
);

router.post(
  '/:id/pre-offers',
  requirePermission('open_tasks.edit'),
  async (req, res) => {
    const customerId = Number(req.params.id);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'customerId غير صالح' });
    }

    const offers = Array.isArray(req.body?.offers) ? req.body.offers : [];
    if (offers.length === 0) {
      return res.status(400).json({ error: 'يجب إرسال عرض واحد على الأقل' });
    }

    const { rows: clientRows } = await pool.query(
      'SELECT branch_id AS "branchId" FROM clients WHERE id = $1 LIMIT 1',
      [customerId],
    );
    if (clientRows.length === 0) {
      return res.status(404).json({ error: 'الزبون غير موجود' });
    }

    const branchId = Number(req.body?.branchId ?? clientRows[0].branchId) || null;

    const pgClient = await pool.connect();
    try {
      await pgClient.query('BEGIN');
      const created: any[] = [];
      for (const offer of offers) {
        const deviceModelId = toPositiveInteger(offer.deviceModelId);
        const quantity = toPositiveInteger(offer.quantity) ?? 1;
        const totalAmount = toPositiveNumber(offer.totalAmount);
        const offerType = offer.offerType === 'installment' ? 'installment' : offer.offerType === 'cash' ? 'cash' : null;
        if (!deviceModelId || !offerType || totalAmount == null) {
          await pgClient.query('ROLLBACK');
          return res.status(400).json({ error: 'بيانات أحد العروض غير مكتملة' });
        }
        const unavailableDeviceModels = await findUnavailableDeviceModelsForNewCommercialUse(pgClient, [deviceModelId]);
        if (unavailableDeviceModels.length > 0) {
          await pgClient.query('ROLLBACK');
          return res.status(400).json(catalogUnavailablePayload('device_model', unavailableDeviceModels));
        }
        const closedByEmployeeId = toPositiveInteger(offer.closedByEmployeeId);
        const noClosingReason = typeof offer.noClosingReason === 'string' ? offer.noClosingReason.trim() || null : null;
        if ((closedByEmployeeId == null && noClosingReason == null) || (closedByEmployeeId != null && noClosingReason != null)) {
          await pgClient.query('ROLLBACK');
          return res.status(400).json({ error: 'كل عرض يجب أن يحتوي إما على موظف تسكير أو سبب عدم التسكير فقط' });
        }
        const { rows } = await pgClient.query(
          `INSERT INTO customer_device_pre_offers (
             customer_id, branch_id, device_model_id, offer_type, quantity, total_amount,
             first_payment_amount, installment_months, currency,
             discount_percentage, applied_device_discount_id, closed_by_employee_id,
            no_closing_reason, response_state, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'SYP'),
             $10, $11, $12, $13, 'pending', $14)
           RETURNING id`,
          [
            customerId,
            branchId,
            deviceModelId,
            offerType,
            quantity,
            totalAmount,
            offer.firstPaymentAmount ?? null,
            offer.installmentMonths ?? null,
            offer.currency ?? 'SYP',
            offer.discountPercentage ?? null,
            offer.appliedDeviceDiscountId ?? null,
            closedByEmployeeId,
            noClosingReason,
            req.authContext?.userId ?? null,
          ],
        );
        created.push({ id: Number(rows[0].id) });
      }
      await pgClient.query('COMMIT');
      res.json({ success: true, created });
    } catch (err: any) {
      await pgClient.query('ROLLBACK');
      console.error('[customerPreOffers] POST error:', err);
      res.status(500).json({ error: err.message || 'فشل في إنشاء عروض الأجهزة' });
    } finally {
      pgClient.release();
    }
  },
);

export default router;
