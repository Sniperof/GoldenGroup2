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

const router = Router();
router.use(requireAuth);

router.get(
  '/:id/pre-offers',
  requirePermission('contracts.view_list'),
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
      )
      SELECT
        po.id                       AS pre_offer_id,
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

        vtr.id                      AS visit_task_result_id,
        vtr.final_decision          AS final_decision_code,
        vtr.closed_at               AS visit_closed_at,
        vtr.closed_by               AS visit_closed_by_id,
        visit_closer.name           AS visit_closed_by_name,
        vtddr.offer_amount::float   AS actual_offer_amount,
        vtddr.contract_id           AS contract_id,
        c.contract_number           AS contract_number,
        c.device_model_id           AS contract_device_model_id

      FROM open_task_pre_offers po
      JOIN open_tasks ot ON ot.id = po.open_task_id
      LEFT JOIN device_models dm ON dm.id = po.device_model_id
      LEFT JOIN employees prep ON prep.id = po.closed_by_employee_id

      LEFT JOIN latest_visit lv ON lv.open_task_id = ot.id
      LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = lv.visit_task_id
      LEFT JOIN visit_task_device_demo_results vtddr ON vtddr.visit_task_result_id = vtr.id
      LEFT JOIN employees visit_closer ON visit_closer.id = vtr.closed_by
      LEFT JOIN contracts c ON c.id = vtddr.contract_id

      WHERE ot.client_id = $1
        AND ot.task_type = 'device_demo'

      ORDER BY ot.created_at DESC, po.id DESC
    `;

    const { rows } = await pool.query(sql, [customerId]);

    function resolveOutcome(r: any): string {
      // (1) No visit_task_result row → never presented.
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
        preOfferId:              Number(r.pre_offer_id),
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

export default router;
