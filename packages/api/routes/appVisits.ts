import { Router } from 'express';
import { requireAppAuth } from '../middleware/appAuth.js';
import pool from '../db.js';
import { sendAppError } from '../utils/appErrors.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: App - Visits
 *     description: Customer mobile-app "My Visits" read-only view. DEC-017.
 */

// DEC-017 D-AV2: the 7 internal visit states (DEC-004) collapse to the 5
// customer-facing labels below. `not_completed` stays distinct so the
// customer knows the team showed up and nothing was done.
const CUSTOMER_VISIT_STATUS: Record<string, string> = {
  scheduled: 'scheduled',
  in_progress: 'in_progress',
  ended: 'in_progress',
  completed: 'completed',
  closed: 'completed',
  not_completed: 'not_completed',
  cancelled: 'cancelled',
};

// DEC-017 D-AV8: `visit_tasks.task_type` has no fixed enum (the DB check is
// just "non-empty text") — the project adds task types in code, not
// migrations. `final_decision` is a per-task-type literal union defined in
// services/visitTaskResultReflection.ts and routes/emergencyResult.ts; there
// is no single lookup table for it. This is a hand-maintained mirror of every
// (task_type, final_decision) pair that exists in code today. A combination
// missing here logs a warning and shows no decision label rather than a raw
// English code — but it WILL silently under-cover any task type or decision
// value added later without a matching update here (accepted tradeoff).
const TASK_DECISION_LABELS: Record<string, Record<string, string>> = {
  device_demo: {
    offer_presented: 'تم تقديم العرض',
    device_sold: 'تم شراء الجهاز',
    rescheduled: 'تم تأجيل الموعد',
    cancelled: 'أُلغيت',
  },
  device_delivery: {
    delivered_successfully: 'تم التسليم بنجاح',
    rescheduled: 'تم تأجيل التسليم',
    delivery_failed: 'تعذّر التسليم',
    customer_not_available: 'تعذّر التسليم — الزبون غير متوفر',
    wrong_address: 'تعذّر التسليم — عنوان غير صحيح',
    refused_delivery: 'الزبون رفض الاستلام',
  },
  device_installation: {
    installed_successfully: 'تم التركيب بنجاح',
    installation_incomplete: 'التركيب غير مكتمل',
    refused_installation: 'الزبون رفض التركيب',
  },
  device_activation: {
    activated_successfully: 'تم التشغيل بنجاح',
    activation_failed: 'تعذّر التشغيل',
    device_issue: 'تعذّر التشغيل — عطل بالجهاز',
  },
  device_checkup: {
    checked_successfully: 'تم الفحص بنجاح',
    reschedule: 'تم تأجيل الفحص',
    customer_refused_checkup: 'الزبون رفض الفحص',
  },
  device_retrieval: {
    retrieved_successfully: 'تم استرجاع الجهاز',
    reschedule: 'تم تأجيل الاسترجاع',
    customer_refused_retrieval: 'الزبون رفض الاسترجاع',
  },
  device_return: {
    returned_successfully: 'تم إرجاع الجهاز بنجاح',
    reschedule: 'تم تأجيل الإرجاع',
    customer_refused_return: 'الزبون رفض الإرجاع',
  },
  device_transfer: {
    transferred_successfully: 'تم نقل الجهاز بنجاح',
    reschedule: 'تم تأجيل النقل',
    customer_refused_transfer: 'الزبون رفض النقل',
  },
  device_disconnection: {
    disconnected_successfully: 'تم فصل الجهاز',
    rescheduled: 'تم تأجيل الفصل',
    disconnection_failed: 'تعذّر الفصل',
    not_disconnected: 'لم يتم الفصل',
    customer_refused_disconnection: 'الزبون رفض الفصل',
    requires_retrieval: 'يتطلب استرجاع الجهاز',
    unsafe_to_disconnect: 'غير آمن للفصل حالياً',
  },
  gift_delivery: {
    delivered_successfully: 'تم تسليم الهدية',
    refused_gift: 'الزبون رفض الهدية',
    rescheduled: 'تم تأجيل تسليم الهدية',
  },
  installment_collection: {
    paid_full: 'تم تحصيل كامل الدفعة',
    paid_partial: 'تم تحصيل جزء من الدفعة',
    rescheduled: 'تم تأجيل التحصيل',
    refused_to_pay: 'الزبون رفض الدفع',
  },
  golden_warranty_offer: {
    activated: 'تم تفعيل عرض الكفالة الذهبية',
    rescheduled: 'تم تأجيل العرض',
    cancelled: 'أُلغي العرض',
  },
  golden_warranty_card_delivery: {
    delivered: 'تم تسليم بطاقة الكفالة',
    rescheduled: 'تم تأجيل تسليم البطاقة',
    cancelled: 'أُلغي التسليم',
  },
  emergency_maintenance: {
    resolved: 'تم حل المشكلة',
    unresolved: 'لم تُحل المشكلة',
    needs_followup: 'يحتاج متابعة إضافية',
    cancelled: 'أُلغيت',
  },
  periodic_maintenance: {
    performed: 'تمت الصيانة الدورية',
    partially_performed: 'تمت الصيانة الدورية جزئياً',
    not_performed: 'لم تتم الصيانة الدورية',
  },
};

function decisionLabel(taskType: string, finalDecision: string | null): string | null {
  if (!finalDecision) return null;
  const label = TASK_DECISION_LABELS[taskType]?.[finalDecision];
  if (!label) {
    console.warn(`[app:visits.detail] no Arabic label for (${taskType}, ${finalDecision})`);
    return null;
  }
  return label;
}

/**
 * @swagger
 * /api/app/me/visits:
 *   get:
 *     tags: [App - Visits]
 *     summary: List every field visit for the authenticated customer
 *     description: >
 *       No lead-window filtering here (DEC-017 D-AV4) — the one-day-ahead
 *       visibility customers see is an emergent property of how visits get
 *       scheduled project-wide, not a WHERE clause on this endpoint. Team
 *       identity is the current effective team (post-reassignment), never a
 *       phone number (DEC-017 D-AV3). Each visit carries the device(s) it
 *       concerns via its visit_tasks (DEC-017 D-AV5).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Visit list for the authenticated customer }
 *       401: { description: Missing or invalid app bearer token }
 */
router.get('/me/visits', requireAppAuth, async (req, res) => {
  try {
    const clientId = req.appAccount!.clientId;
    const { rows } = await pool.query(
      `SELECT fv.id,
              fv.status AS "internalStatus",
              fv.visit_type AS "visitType",
              fv.scheduled_date AS "scheduledDate",
              fv.scheduled_time AS "scheduledTime",
              sup.name AS "supervisorName",
              tech.name AS "technicianName",
              devices.device_names AS "deviceNames"
         FROM field_visits fv
         LEFT JOIN employees sup
           ON sup.id = COALESCE(fv.reassigned_supervisor_id, NULLIF((fv.team_snapshot->>'supervisorEmployeeId')::text, '')::int)
         LEFT JOIN employees tech
           ON tech.id = COALESCE(fv.reassigned_technician_id, NULLIF((fv.team_snapshot->>'technicianEmployeeId')::text, '')::int)
         LEFT JOIN LATERAL (
           SELECT array_agg(DISTINCT COALESCE(NULLIF(d.device_model_name, ''), dm.name_ar, dm.name_en, dm.name))
                    FILTER (WHERE d.id IS NOT NULL) AS device_names
             FROM visit_tasks vt
             LEFT JOIN installed_devices d ON d.contract_id = vt.contract_id
             LEFT JOIN device_models dm ON dm.id = d.device_model_id
            WHERE vt.field_visit_id = fv.id
         ) devices ON TRUE
        WHERE fv.client_id = $1
        ORDER BY fv.scheduled_date DESC NULLS LAST, fv.id DESC`,
      [clientId],
    );
    const items = rows.map((row) => {
      const { internalStatus, ...rest } = row;
      return { ...rest, status: CUSTOMER_VISIT_STATUS[internalStatus] ?? internalStatus };
    });
    return res.json({ items });
  } catch (err) {
    return sendAppError(res, err, 'visits.mine');
  }
});

/**
 * @swagger
 * /api/app/me/visits/{id}:
 *   get:
 *     tags: [App - Visits]
 *     summary: Get one field visit's detail for the authenticated customer
 *     description: >
 *       Per-task breakdown (device + result), DEC-017 D-AV8: each task shows
 *       its type, its device (id/name/serial — richer than the list's plain
 *       names), and its result as an Arabic label resolved from a hand-kept
 *       dictionary. Never `closing_notes`/`cancellation_notes` — free text
 *       written for internal record-keeping, not the customer (D-AV8/D-AV9).
 *       No GPS/actual-execution timing (D-AV10). No booking/telemarketer
 *       fields (D-AV11).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Visit detail }
 *       400: { description: Invalid visit id }
 *       401: { description: Missing or invalid app bearer token }
 *       404: { description: "Visit missing or not owned by this customer (indistinguishable, by design)" }
 */
router.get('/me/visits/:id', requireAppAuth, async (req, res) => {
  try {
    const visitId = Number(req.params.id);
    if (!Number.isInteger(visitId) || visitId <= 0) {
      return res.status(400).json({ error: 'معرف الزيارة غير صالح' });
    }
    const clientId = req.appAccount!.clientId;

    const { rows: visitRows } = await pool.query(
      `SELECT fv.id,
              fv.status AS "internalStatus",
              fv.visit_type AS "visitType",
              fv.scheduled_date AS "scheduledDate",
              fv.scheduled_time AS "scheduledTime",
              sup.name AS "supervisorName",
              tech.name AS "technicianName",
              cr.value AS "cancellationReasonLabel"
         FROM field_visits fv
         LEFT JOIN employees sup
           ON sup.id = COALESCE(fv.reassigned_supervisor_id, NULLIF((fv.team_snapshot->>'supervisorEmployeeId')::text, '')::int)
         LEFT JOIN employees tech
           ON tech.id = COALESCE(fv.reassigned_technician_id, NULLIF((fv.team_snapshot->>'technicianEmployeeId')::text, '')::int)
         LEFT JOIN system_lists cr ON cr.id = fv.cancellation_reason_id
        WHERE fv.client_id = $1 AND fv.id = $2`,
      [clientId, visitId],
    );
    const visit = visitRows[0];
    // Same 404 whether the id doesn't exist or belongs to another customer —
    // never confirm a foreign visit id exists.
    if (!visit) return res.status(404).json({ error: 'الزيارة غير موجودة' });

    const { rows: taskRows } = await pool.query(
      `SELECT vt.id,
              vt.task_type AS "taskType",
              d.id AS "deviceId",
              COALESCE(NULLIF(d.device_model_name, ''), dm.name_ar, dm.name_en, dm.name) AS "deviceName",
              d.serial_number AS "deviceSerialNumber",
              vtr.final_decision AS "finalDecision",
              reason.label AS "reasonLabel"
         FROM visit_tasks vt
         LEFT JOIN installed_devices d ON d.contract_id = vt.contract_id
         LEFT JOIN device_models dm ON dm.id = d.device_model_id
         LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
         LEFT JOIN LATERAL (
           SELECT COALESCE(sl.metadata->>'label', sl.value) AS label
             FROM system_lists sl
            WHERE sl.value = vtr.reason_code
            LIMIT 1
         ) reason ON vtr.reason_code IS NOT NULL
        WHERE vt.field_visit_id = $1
        ORDER BY vt.sequence_no, vt.id`,
      [visitId],
    );

    const { internalStatus, cancellationReasonLabel, ...rest } = visit;
    return res.json({
      ...rest,
      status: CUSTOMER_VISIT_STATUS[internalStatus] ?? internalStatus,
      cancellationReasonLabel: internalStatus === 'cancelled' ? cancellationReasonLabel : null,
      tasks: taskRows.map((task) => ({
        id: task.id,
        taskType: task.taskType,
        deviceId: task.deviceId,
        deviceName: task.deviceName,
        deviceSerialNumber: task.deviceSerialNumber,
        decisionLabel: decisionLabel(task.taskType, task.finalDecision),
        reasonLabel: task.reasonLabel ?? null,
      })),
    });
  } catch (err) {
    return sendAppError(res, err, 'visits.detail');
  }
});

export default router;
