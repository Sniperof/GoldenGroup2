import { Router } from 'express';
import type {
  FieldVisitStatus,
  MarketingVisitStatus,
  MarketingVisitTaskOfferInput,
  MarketingVisitTaskOutcome,
  MarketingVisitTaskResult,
} from '@golden-crm/shared';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import {
  buildCustomerOwnershipSelectColumns,
  buildCustomerOwnershipSql,
  mapCustomerOwnership,
} from '../services/customerOwnership.js';

const router = Router();

const RESULT_ALLOWED_STATUSES = new Set<MarketingVisitStatus>([
  'completed',
  'not_completed',
  'cancelled',
  'needs_reschedule',
]);

const COMPLETED_RESULT_CODES = new Set<MarketingVisitTaskResult>([
  'cash_offer_closed',
  'installment_offer_closed',
  'cash_offer_not_closed',
  'installment_offer_not_closed',
  'demo_not_completed',
]);

const CASH_RESULTS = new Set<MarketingVisitTaskResult>([
  'cash_offer_closed',
  'cash_offer_not_closed',
]);

const INSTALLMENT_RESULTS = new Set<MarketingVisitTaskResult>([
  'installment_offer_closed',
  'installment_offer_not_closed',
]);

const CLOSED_RESULTS = new Set<MarketingVisitTaskResult>([
  'cash_offer_closed',
  'installment_offer_closed',
]);

const VISIT_STATUS_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  scheduled: ['in_visit'],
  in_visit: ['ended'],
};

const VALID_OPEN_TASK_PRIORITIES = new Set(['high', 'medium', 'low']);

function getBranchId(req: any): number | null {
  const branchId = req.authContext?.actingBranchId;
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function isGlobalUser(req: any): boolean {
  if (req.authContext?.isSuperAdmin) return true;
  const grants: any[] = req.authContext?.grants || [];
  return grants.some((grant: any) => grant.permission === 'marketing_visits.view' && grant.scope === 'GLOBAL');
}

async function generateSaleReferenceNumber(pgClient: any): Promise<string> {
  const { rows } = await pgClient.query(
    `SELECT COALESCE(MAX(CAST(sale_reference_number AS INTEGER)), 0) + 1 AS next_num
     FROM marketing_visit_tasks
     WHERE sale_reference_number ~ '^[0-9]+$'`,
  );
  const nextNum = rows[0]?.next_num ?? 1;
  return String(nextNum).padStart(5, '0');
}

function normalizeOptionalDate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function normalizeMarketingVisitStatus(status: string | null | undefined): string | null {
  if (status == null) return null;
  return status === 'rescheduled' ? 'needs_reschedule' : status;
}

function mapVisitRows(rows: any[]) {
  const visits = new Map<string, any>();

  rows.forEach((row) => {
    if (!visits.has(row.id)) {
      visits.set(row.id, {
        id: row.id,
        branchId: row.branchId,
        clientId: row.clientId,
        visitType: row.visitType,
        status: normalizeMarketingVisitStatus(row.status),
        scheduledDate: row.scheduledDate,
        scheduledTime: row.scheduledTime,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        contactTargetId: row.contactTargetId,
        taskListId: row.taskListId,
        taskListItemId: row.taskListItemId,
        teamKey: row.teamKey,
        requestedDeviceModelId: row.requestedDeviceModelId,
        requestedDeviceName: row.requestedDeviceName,
        waterSource: row.waterSource,
        technicianNotes: row.technicianNotes,
        customerName: row.customerName,
        customerAddress: row.customerAddress,
        customerMobile: row.customerMobile,
        clientNickname: row.clientNickname ?? null,
        clientOccupation: row.clientOccupation ?? null,
        clientGender: row.clientGender ?? null,
        clientDataQuality: row.clientDataQuality ?? null,
        clientRating: row.clientRating ?? null,
        clientContacts: row.clientContacts ?? null,
        clientGovernorate: row.clientGovernorate,
        clientDistrict: row.clientDistrict,
        clientNeighborhood: row.clientNeighborhood,
        clientDetailedAddress: row.clientDetailedAddress,
        clientGpsCoordinates: row.clientGpsCoordinates,
        branchName: row.branchName ?? null,
        ownership: mapCustomerOwnership(row),
        supervisorEmployeeId: row.supervisorEmployeeId,
        technicianEmployeeId: row.technicianEmployeeId,
        traineeEmployeeId: row.traineeEmployeeId,
        teamSnapshot: row.teamSnapshot,
        createdBy: row.createdBy,
        completedBy: row.completedBy,
        completedAt: row.completedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        workRouteCount: row.workRouteCount ?? 0,
        additionalAreaCount: row.additionalAreaCount ?? 0,
        task: null,
        tasks: [],
      });
    }

    if (row.taskId) {
      const task = {
        id: row.taskId,
        visitId: row.id,
        taskType: row.taskType,
        status: row.taskStatus,
        result: row.taskResult,
        cashOfferAmount: row.cashOfferAmount != null ? Number(row.cashOfferAmount) : null,
        installmentAmount: row.installmentAmount != null ? Number(row.installmentAmount) : null,
        installmentMonths: row.installmentMonths,
        closedByEmployeeId: row.closedByEmployeeId,
        resultNotes: row.resultNotes,
        contractId: row.contractId,
        completedAt: row.taskCompletedAt,
        createdAt: row.taskCreatedAt,
        updatedAt: row.taskUpdatedAt,
        sourceOpenTaskId: row.sourceOpenTaskId ?? null,
        openTaskPriority: row.openTaskPriority ?? null,
        openTaskDueDate: row.openTaskDueDate ?? null,
        currency: row.currency ?? null,
        discountPercentage: row.discountPercentage != null ? Number(row.discountPercentage) : null,
        soldDeviceModelId: row.soldDeviceModelId ?? null,
        soldDeviceModelName: row.soldDeviceModelName ?? null,
        offeredDeviceModelId: row.offeredDeviceModelId ?? null,
        offeredDeviceModelName: row.offeredDeviceModelName ?? null,
        noClosingReason: row.noClosingReason ?? null,
        outcome: row.outcome ?? null,
        offerType: row.offerType ?? null,
        hasDiscount: row.hasDiscount ?? null,
        isDeviceSold: row.isDeviceSold ?? null,
        saleReferenceNumber: row.saleReferenceNumber ?? null,
        cancellationReasonId: row.cancellationReasonId ?? null,
        cancellationReasonName: row.cancellationReasonName ?? null,
        rescheduleReasonId: row.rescheduleReasonId ?? null,
        rescheduleReasonName: row.rescheduleReasonName ?? null,
        followUpDueDate: row.followUpDueDate ?? null,
        cancellationReason: row.cancellationReason ?? null,
        rescheduleReason: row.rescheduleReason ?? null,
      };
      const visit = visits.get(row.id);
      visit.task = task;
      visit.tasks.push(task);
    }
  });

  return Array.from(visits.values());
}

function buildVisitSelect(whereClause: string) {
  return `
    SELECT
      mv.id,
      mv.branch_id AS "branchId",
      mv.client_id AS "clientId",
      mv.visit_type AS "visitType",
      mv.status,
      mv.scheduled_date AS "scheduledDate",
      mv.scheduled_time AS "scheduledTime",
      mv.source_type AS "sourceType",
      mv.source_id AS "sourceId",
      mv.contact_target_id AS "contactTargetId",
      mv.task_list_id AS "taskListId",
      mv.task_list_item_id AS "taskListItemId",
      mv.team_key AS "teamKey",
      mv.requested_device_model_id AS "requestedDeviceModelId",
      mv.requested_device_name AS "requestedDeviceName",
      mv.water_source AS "waterSource",
      mv.technician_notes AS "technicianNotes",
      mv.customer_name AS "customerName",
      mv.customer_address AS "customerAddress",
      mv.customer_mobile AS "customerMobile",
      c.nickname AS "clientNickname",
      c.occupation AS "clientOccupation",
      c.gender AS "clientGender",
      c.data_quality AS "clientDataQuality",
      c.rating AS "clientRating",
      c.contacts AS "clientContacts",
      c.governorate AS "clientGovernorate",
      c.district AS "clientDistrict",
      c.neighborhood AS "clientNeighborhood",
      c.detailed_address AS "clientDetailedAddress",
      c.gps_coordinates AS "clientGpsCoordinates",
      b.name AS "branchName",
      ${buildCustomerOwnershipSelectColumns()},
      mv.supervisor_employee_id AS "supervisorEmployeeId",
      mv.technician_employee_id AS "technicianEmployeeId",
      mv.trainee_employee_id AS "traineeEmployeeId",
      mv.team_snapshot AS "teamSnapshot",
      mv.created_by AS "createdBy",
      mv.completed_by AS "completedBy",
      mv.completed_at AS "completedAt",
      mv.created_at AS "createdAt",
      mv.updated_at AS "updatedAt",
      COALESCE(jsonb_array_length(ra.routes), 0) AS "workRouteCount",
      COALESCE(jsonb_array_length(ra.extra_zones), 0) AS "additionalAreaCount",
      mvt.id AS "taskId",
      mvt.task_type AS "taskType",
      mvt.status AS "taskStatus",
      mvt.result AS "taskResult",
      mvt.cash_offer_amount AS "cashOfferAmount",
      mvt.installment_amount AS "installmentAmount",
      mvt.installment_months AS "installmentMonths",
      mvt.closed_by_employee_id AS "closedByEmployeeId",
      mvt.result_notes AS "resultNotes",
      mvt.contract_id AS "contractId",
      mvt.completed_at AS "taskCompletedAt",
      mvt.created_at AS "taskCreatedAt",
      mvt.updated_at AS "taskUpdatedAt",
      mvt.source_open_task_id AS "sourceOpenTaskId",
      ot.priority AS "openTaskPriority",
      ot.due_date AS "openTaskDueDate",
      mvt.currency,
      mvt.discount_percentage AS "discountPercentage",
      mvt.sold_device_model_id AS "soldDeviceModelId",
      dm_sold.name AS "soldDeviceModelName",
      mvt.offered_device_model_id AS "offeredDeviceModelId",
      dm_offered.name AS "offeredDeviceModelName",
      mvt.no_closing_reason AS "noClosingReason",
      mvt.outcome,
      mvt.offer_type AS "offerType",
      mvt.has_discount AS "hasDiscount",
      mvt.is_device_sold AS "isDeviceSold",
      mvt.sale_reference_number AS "saleReferenceNumber",
      mvt.follow_up_due_date AS "followUpDueDate",
      mvt.cancellation_reason_id AS "cancellationReasonId",
      cr.value AS "cancellationReasonName",
      mvt.reschedule_reason_id AS "rescheduleReasonId",
      rr.value AS "rescheduleReasonName",
      mvt.cancellation_reason AS "cancellationReason",
      mvt.reschedule_reason AS "rescheduleReason"
    FROM marketing_visits mv
    LEFT JOIN clients c ON c.id = mv.client_id
    LEFT JOIN branches b ON b.id = mv.branch_id
    LEFT JOIN branches cb ON cb.id = c.branch_id
    ${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'cb.name' })}
    LEFT JOIN route_assignments ra ON ra.key = mv.scheduled_date || '_' || mv.team_key
    LEFT JOIN marketing_visit_tasks mvt ON mvt.visit_id = mv.id
    LEFT JOIN open_tasks ot ON ot.id = mvt.source_open_task_id
    LEFT JOIN system_lists cr ON cr.id = mvt.cancellation_reason_id
    LEFT JOIN system_lists rr ON rr.id = mvt.reschedule_reason_id
    LEFT JOIN device_models dm_sold ON dm_sold.id = mvt.sold_device_model_id
    LEFT JOIN device_models dm_offered ON dm_offered.id = mvt.offered_device_model_id
    ${whereClause}
  `;
}

async function loadVisitById(req: any, visitId: string) {
  const branchId = getBranchId(req);
  if (!isGlobalUser(req) && branchId == null) {
    return null;
  }

  const params: any[] = [visitId];
  let whereClause = `WHERE mv.id = $1`;

  if (branchId != null) {
    whereClause += ` AND mv.branch_id = $2`;
    params.push(branchId);
  }

  const { rows } = await pool.query(
    `${buildVisitSelect(whereClause)} LIMIT 10`,
    params,
  );

  const visits = mapVisitRows(rows);
  const visit = visits[0] ?? null;
  const taskId = visit?.task?.id ?? null;
  if (!visit || taskId == null) {
    return visit;
  }

  const { rows: offerRows } = await pool.query(
    `SELECT
       device_model_id AS "deviceModelId",
       offer_type AS "offerType",
       quantity,
       total_amount AS "totalAmount",
       first_payment_amount AS "firstPaymentAmount",
       installment_months AS "installmentMonths",
       currency,
       discount_percentage AS "discountPercentage",
       closed_by_employee_id AS "closedByEmployeeId",
       no_closing_reason AS "noClosingReason",
       customer_response AS "customerResponse",
       rejection_reason_id AS "rejectionReasonId",
       extension_reason_id AS "extensionReasonId",
       extension_due_date AS "extensionDueDate",
       sale_reference_number AS "saleReferenceNumber"
     FROM marketing_visit_task_offers
     WHERE task_id = $1`,
    [taskId],
  );

  const sourceOpenTaskId = visit?.task?.sourceOpenTaskId ?? null;
  const { rows: preOfferRows } = sourceOpenTaskId == null
    ? { rows: [] as any[] }
    : await pool.query(
      `SELECT
         device_model_id AS "deviceModelId",
         offer_type AS "offerType",
         quantity,
         total_amount AS "totalAmount",
         first_payment_amount AS "firstPaymentAmount",
         installment_months AS "installmentMonths",
         currency,
         discount_percentage AS "discountPercentage",
         closed_by_employee_id AS "closedByEmployeeId",
         no_closing_reason AS "noClosingReason"
       FROM open_task_pre_offers
       WHERE open_task_id = $1`,
      [sourceOpenTaskId],
    );

  visit.task.offers = offerRows.map((offer) => ({
    ...offer,
    totalAmount: offer.totalAmount != null ? Number(offer.totalAmount) : null,
    firstPaymentAmount: offer.firstPaymentAmount != null ? Number(offer.firstPaymentAmount) : null,
    discountPercentage: offer.discountPercentage != null ? Number(offer.discountPercentage) : null,
  }));
  visit.task.preOffers = preOfferRows.map((offer) => ({
    ...offer,
    totalAmount: offer.totalAmount != null ? Number(offer.totalAmount) : null,
    firstPaymentAmount: offer.firstPaymentAmount != null ? Number(offer.firstPaymentAmount) : null,
    discountPercentage: offer.discountPercentage != null ? Number(offer.discountPercentage) : null,
  }));

  if (Array.isArray(visit.tasks)) {
    visit.tasks = visit.tasks.map((task: any) =>
      String(task.id) === String(taskId)
        ? { ...task, offers: visit.task.offers, preOffers: visit.task.preOffers }
        : task,
    );
  }

  return visit;
}

router.get('/', requirePermission('marketing_visits.view'), async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  const clientId = typeof req.query.clientId === 'string' ? Number(req.query.clientId) : null;
  const branchId = getBranchId(req);

  if (clientId != null && !Number.isFinite(clientId)) {
    return res.status(400).json({ error: 'clientId must be a valid number' });
  }

  if (!clientId && (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  if (!isGlobalUser(req) && branchId == null) {
    return res.status(400).json({ error: 'A branch context is required' });
  }

  const params: any[] = [clientId ?? date];
  let whereClause = clientId ? `WHERE mv.client_id = $1` : `WHERE mv.scheduled_date = $1`;

  if (branchId != null) {
    whereClause += ` AND mv.branch_id = $2`;
    params.push(branchId);
  }

  const { rows } = await pool.query(
    `${buildVisitSelect(whereClause)} ORDER BY mv.scheduled_time ASC, mv.created_at ASC`,
    params,
  );

  return res.json(mapVisitRows(rows));
});

router.get('/:id', requirePermission('marketing_visits.view'), async (req, res) => {
  const visit = await loadVisitById(req, String(req.params.id));
  if (!visit) {
    return res.status(404).json({ error: 'Marketing visit not found' });
  }
  return res.json(visit);
});

router.patch('/:id/result', requirePermission('marketing_visits.update_result'), async (req, res) => {
  const visit = await loadVisitById(req, String(req.params.id));
  if (!visit) {
    return res.status(404).json({ error: 'Marketing visit not found' });
  }
  // Legacy endpoint: redirects to the first device_demo task for backwards compat.
  const legacyTask = (visit.tasks || []).find((t: any) => t.taskType === 'device_demo');
  if (!legacyTask) {
    return res.status(404).json({ error: 'No device_demo task found on this visit' });
  }
  return applyTaskResult(req, res, visit, legacyTask);
});

router.patch('/:visitId/tasks/:taskId/result', requirePermission('marketing_visits.update_result'), async (req, res) => {
  const visit = await loadVisitById(req, String(req.params.visitId));
  if (!visit) {
    return res.status(404).json({ error: 'Marketing visit not found' });
  }
  const taskId = String(req.params.taskId);
  const task = (visit.tasks || []).find((t: any) => String(t.id) === taskId);
  if (!task) {
    return res.status(404).json({ error: 'Marketing visit task not found' });
  }
  return applyTaskResult(req, res, visit, task);
});

/** @deprecated Use applyTaskOutcome and the /outcome endpoint for new clients. */
async function applyTaskResult(req: any, res: any, visit: any, task: any) {
  const rawStatus = typeof req.body?.status === 'string' ? req.body.status : undefined;
  const status = (rawStatus === 'rescheduled' ? 'needs_reschedule' : rawStatus) as MarketingVisitStatus | undefined;
  const taskResult = req.body?.taskResult as MarketingVisitTaskResult | undefined;
  const cashOfferAmount = req.body?.cashOfferAmount;
  const installmentAmount = req.body?.installmentAmount;
  const installmentMonths = req.body?.installmentMonths;
  const closedByEmployeeId = req.body?.closedByEmployeeId;
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
  const discountPercentage = req.body?.discountPercentage ?? null;
  const currency = typeof req.body?.currency === 'string' ? req.body.currency.trim() || null : null;
  const soldDeviceModelId = req.body?.soldDeviceModelId ?? null;
  const noClosingReason = typeof req.body?.noClosingReason === 'string' ? req.body.noClosingReason.trim() || null : null;

  if (!status || !RESULT_ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Unsupported marketing visit status' });
  }

  if (status === 'completed') {
    if (!taskResult || !COMPLETED_RESULT_CODES.has(taskResult)) {
      return res.status(400).json({ error: 'taskResult is required when status is completed' });
    }

    if (CASH_RESULTS.has(taskResult)) {
      if (typeof cashOfferAmount !== 'number' || !(cashOfferAmount > 0)) {
        return res.status(400).json({ error: 'cashOfferAmount must be greater than 0' });
      }
    }

    if (INSTALLMENT_RESULTS.has(taskResult)) {
      if (typeof installmentAmount !== 'number' || !(installmentAmount > 0)) {
        return res.status(400).json({ error: 'installmentAmount must be greater than 0' });
      }
      if (!Number.isInteger(installmentMonths) || !(installmentMonths > 0)) {
        return res.status(400).json({ error: 'installmentMonths must be greater than 0' });
      }
    }

    if (CLOSED_RESULTS.has(taskResult)) {
      if (!Number.isInteger(closedByEmployeeId) || !(closedByEmployeeId > 0)) {
        return res.status(400).json({ error: 'closedByEmployeeId is required for closed offers' });
      }
    }

    if (taskResult === 'demo_not_completed' && !notes) {
      return res.status(400).json({ error: 'notes are required when demo is not completed' });
    }

    if ((taskResult === 'cash_offer_not_closed' || taskResult === 'installment_offer_not_closed') && !noClosingReason) {
      return res.status(400).json({ error: 'noClosingReason is required for not-closed offers' });
    }
  } else if (!notes) {
    return res.status(400).json({ error: 'notes are required for non-completed marketing visit statuses' });
  }

  const taskStatus = status === 'completed'
    ? (taskResult === 'demo_not_completed' ? 'not_completed' : 'completed')
    : 'not_completed';

  const completedBy = req.authContext?.userId ?? null;
  const pgClient = await pool.connect();

  try {
    await pgClient.query('BEGIN');

    if (status === 'completed') {
      await pgClient.query(
        `UPDATE marketing_visits
         SET status = $1, completed_by = $2, completed_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [status, completedBy, visit.id],
      );

      const isNotClosedOffer = taskResult === 'cash_offer_not_closed' || taskResult === 'installment_offer_not_closed';
      await pgClient.query(
        `UPDATE marketing_visit_tasks
         SET status = $1,
             result = $2,
             cash_offer_amount = $3,
             installment_amount = $4,
             installment_months = $5,
             closed_by_employee_id = $6,
             result_notes = $7,
             currency = $8,
             discount_percentage = $9,
             sold_device_model_id = $10,
             no_closing_reason = $11,
             contract_id = NULL,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $12 AND visit_id = $13`,
        [
          taskStatus,
          taskResult,
          CASH_RESULTS.has(taskResult!) ? cashOfferAmount : null,
          INSTALLMENT_RESULTS.has(taskResult!) ? installmentAmount : null,
          INSTALLMENT_RESULTS.has(taskResult!) ? installmentMonths : null,
          CLOSED_RESULTS.has(taskResult!) ? closedByEmployeeId : null,
          notes || null,
          currency || 'SYP',
          discountPercentage != null && Number.isFinite(Number(discountPercentage)) ? Number(discountPercentage) : null,
          CLOSED_RESULTS.has(taskResult!) && soldDeviceModelId != null ? Number(soldDeviceModelId) : null,
          isNotClosedOffer ? noClosingReason : null,
          task.id,
          visit.id,
        ],
      );
    } else {
      await pgClient.query(
        `UPDATE marketing_visits
         SET status = $1, completed_by = NULL, completed_at = NULL, updated_at = NOW()
         WHERE id = $2`,
        [status, visit.id],
      );

      await pgClient.query(
        `UPDATE marketing_visit_tasks
         SET status = 'not_completed',
             result = NULL,
             cash_offer_amount = NULL,
             installment_amount = NULL,
             installment_months = NULL,
             closed_by_employee_id = NULL,
             result_notes = $1,
             currency = NULL,
             discount_percentage = NULL,
             sold_device_model_id = NULL,
             no_closing_reason = NULL,
             contract_id = NULL,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2 AND visit_id = $3`,
        [notes, task.id, visit.id],
      );
    }

    // Update linked open_task for THIS task only
    const openTaskId = task.sourceOpenTaskId ?? null;
    if (openTaskId != null) {
      const { rows: preStatusRows } = await pgClient.query(
        'SELECT status FROM open_tasks WHERE id = $1',
        [openTaskId],
      );
      const oldOpenTaskStatus = preStatusRows[0]?.status;
      let newOpenTaskStatus: string;
      if (status === 'cancelled') {
        newOpenTaskStatus = 'cancelled';
      } else if (status === 'completed') {
        if (taskResult === 'cash_offer_closed' || taskResult === 'installment_offer_closed') {
          newOpenTaskStatus = 'completed';
        } else {
          newOpenTaskStatus = 'needs_reschedule';
        }
      } else {
        newOpenTaskStatus = 'needs_reschedule';
      }
      const mvUpdateResult = await pgClient.query(
        `UPDATE open_tasks SET status = $1, updated_at = NOW()
         WHERE id = $2 AND status IN ('in_visit', 'scheduled', 'in_contact_list')`,
        [newOpenTaskStatus, openTaskId],
      );
      if ((mvUpdateResult as any).rowCount > 0 && oldOpenTaskStatus && oldOpenTaskStatus !== newOpenTaskStatus) {
        await pgClient.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
           VALUES ($1, 'status_change', $2, NULL, $3, $4)`,
          [openTaskId, completedBy, oldOpenTaskStatus, newOpenTaskStatus],
        );
      }
    }

    // ── Parallel write to visit core tables (Strangler bridge) ──────────────
    const isFinalized = status === 'completed' || status === 'cancelled';

    // 1. Upsert field_visits record
    const { rows: coreVisitRows } = await pgClient.query(
      `INSERT INTO field_visits (
         visit_type, visit_family, status,
         client_id, branch_id,
         scheduled_date, scheduled_time,
         source_legacy_type, source_legacy_id,
         team_snapshot,
         closed_by, closed_at, created_by,
         created_at, updated_at
       ) VALUES (
         'marketing', 'marketing', $1,
         $2, $3,
         $4::date, $5,
         'marketing_visit', $6,
         $7::jsonb,
         $8, $9, $10,
         NOW(), NOW()
       )
       ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET
         status     = EXCLUDED.status,
         closed_by  = EXCLUDED.closed_by,
         closed_at  = EXCLUDED.closed_at,
         updated_at = NOW()
       RETURNING id`,
      [
        status,
        visit.clientId,
        visit.branchId,
        visit.scheduledDate,
        visit.scheduledTime,
        visit.id,
        visit.teamSnapshot != null ? JSON.stringify(visit.teamSnapshot) : null,
        isFinalized ? completedBy : null,
        isFinalized ? new Date() : null,
        visit.createdBy ?? null,
      ],
    );
    const coreVisitId = coreVisitRows[0].id;

    // 2. Upsert visit_tasks record for this specific task
    const sameTypeTasksBefore = (visit.tasks || []).filter((t: any) => t.taskType === task.taskType);
    const taskSequenceNo = sameTypeTasksBefore.findIndex((t: any) => String(t.id) === String(task.id)) + 1;

    const { rows: coreTaskRows } = await pgClient.query(
      `INSERT INTO visit_tasks (
         field_visit_id, source_open_task_id,
         task_type, task_family, sequence_no,
         status, execution_notes,
         source_legacy_type, source_legacy_id,
         created_at, updated_at
       ) VALUES (
         $1, $2,
         'device_demo', 'marketing', $3,
         $4, $5,
         'marketing_visit_task', $6,
         NOW(), NOW()
       )
       ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET
         status              = EXCLUDED.status,
         execution_notes     = EXCLUDED.execution_notes,
         source_open_task_id = COALESCE(EXCLUDED.source_open_task_id, visit_tasks.source_open_task_id),
         updated_at          = NOW()
       RETURNING id`,
      [
        coreVisitId,
        task.sourceOpenTaskId ?? null,
        taskSequenceNo,
        taskStatus,
        notes || null,
        task.id,
      ],
    );
    const coreTaskId = coreTaskRows[0].id;

    // 3. Upsert visit_task_results record
    const coreFinalDecision = status === 'completed' && taskResult ? taskResult : 'not_completed';
    const coreReasonCode = status !== 'completed' ? status : null;

    const { rows: coreResultRows } = await pgClient.query(
      `INSERT INTO visit_task_results (
         visit_task_id, final_decision, reason_code, closing_notes,
         closed_by, closed_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, NOW(), NOW(), NOW()
       )
       ON CONFLICT (visit_task_id) DO UPDATE SET
         final_decision = EXCLUDED.final_decision,
         reason_code    = EXCLUDED.reason_code,
         closing_notes  = EXCLUDED.closing_notes,
         closed_by      = EXCLUDED.closed_by,
         closed_at      = NOW(),
         updated_at     = NOW()
       RETURNING id`,
      [
        coreTaskId,
        coreFinalDecision,
        coreReasonCode,
        notes || null,
        completedBy,
      ],
    );
    const coreResultId = coreResultRows[0].id;

    // 4. Manage visit_task_device_demo_results for this task
    const isOfferResult = status === 'completed' && taskResult && taskResult !== 'demo_not_completed';

    if (!isOfferResult) {
      await pgClient.query(
        'DELETE FROM visit_task_device_demo_results WHERE visit_task_result_id = $1',
        [coreResultId],
      );
    } else {
      const offerType = CASH_RESULTS.has(taskResult!) ? 'cash' : 'installment';
      const offerAmount = CASH_RESULTS.has(taskResult!) ? cashOfferAmount : installmentAmount;
      const months = INSTALLMENT_RESULTS.has(taskResult!) ? installmentMonths : null;
      const demoClosedBy = CLOSED_RESULTS.has(taskResult!) ? closedByEmployeeId : null;

      const demoDiscountPct = discountPercentage != null && Number.isFinite(Number(discountPercentage)) ? Number(discountPercentage) : null;
      await pgClient.query(
        `INSERT INTO visit_task_device_demo_results (
           visit_task_result_id,
           offer_type, offer_amount, installment_months,
           closed_by_employee_id,
           discount_percentage,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (visit_task_result_id) DO UPDATE SET
           offer_type            = EXCLUDED.offer_type,
           offer_amount          = EXCLUDED.offer_amount,
           installment_months    = EXCLUDED.installment_months,
           closed_by_employee_id = EXCLUDED.closed_by_employee_id,
           discount_percentage   = EXCLUDED.discount_percentage,
           updated_at            = NOW()`,
        [
          coreResultId,
          offerType,
          offerAmount ?? null,
          months ?? null,
          demoClosedBy ?? null,
          demoDiscountPct,
        ],
      );
    }
    // ── End parallel write ────────────────────────────────────────────────────

    await pgClient.query('COMMIT');
  } catch (error) {
    await pgClient.query('ROLLBACK');
    throw error;
  } finally {
    pgClient.release();
  }

  const updatedVisit = await loadVisitById(req, String(visit.id));
  return res.json(updatedVisit);
}

router.patch('/:id/status', requirePermission('marketing_visits.update_result'), async (req, res) => {
  const visit = await loadVisitById(req, String(req.params.id));
  if (!visit) return res.status(404).json({ error: 'Marketing visit not found' });

  const newStatus = req.body?.status as string | undefined;
  const allowed = VISIT_STATUS_ALLOWED_TRANSITIONS[visit.status] ?? [];
  if (!newStatus || !allowed.includes(newStatus)) {
    return res.status(400).json({
      error: `Cannot transition from "${visit.status}" to "${newStatus}"`,
    });
  }

  await pool.query(
    'UPDATE marketing_visits SET status = $1, updated_at = NOW() WHERE id = $2',
    [newStatus, visit.id],
  );

  const updated = await loadVisitById(req, visit.id);
  return res.json(updated);
});

router.patch('/:id/reschedule', requirePermission('marketing_visits.update_result'), async (req, res) => {
  const visit = await loadVisitById(req, String(req.params.id));
  if (!visit) return res.status(404).json({ error: 'Marketing visit not found' });
  return applyVisitLifecycleAction(req, res, visit, 'needs_reschedule');
});

router.patch('/:id/cancel', requirePermission('marketing_visits.update_result'), async (req, res) => {
  const visit = await loadVisitById(req, String(req.params.id));
  if (!visit) return res.status(404).json({ error: 'Marketing visit not found' });
  return applyVisitLifecycleAction(req, res, visit, 'cancelled');
});

router.patch('/:visitId/tasks/:taskId/outcome', requirePermission('marketing_visits.update_result'), async (req, res) => {
  const visit = await loadVisitById(req, String(req.params.visitId));
  if (!visit) return res.status(404).json({ error: 'Marketing visit not found' });
  const taskId = String(req.params.taskId);
  const task = (visit.tasks || []).find((t: any) => String(t.id) === taskId);
  if (!task) return res.status(404).json({ error: 'Marketing visit task not found' });
  return applyTaskOutcome(req, res, visit, task);
});

async function applyVisitLifecycleAction(
  req: any,
  res: any,
  visit: any,
  targetStatus: 'needs_reschedule' | 'cancelled',
) {
  if (!['scheduled', 'in_visit'].includes(visit.status)) {
    return res.status(400).json({
      error: `Cannot transition from "${visit.status}" to "${targetStatus}"`,
    });
  }

  const reasonField = targetStatus === 'needs_reschedule' ? 'rescheduleReasonId' : 'cancellationReasonId';
  const reasonId = req.body?.[reasonField];
  if (!Number.isInteger(reasonId) || !(reasonId > 0)) {
    return res.status(400).json({ error: `${reasonField} is required` });
  }

  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() || null : null;
  const taskUpdates = Array.isArray(req.body?.taskUpdates) ? req.body.taskUpdates : null;
  if (!taskUpdates || taskUpdates.length === 0) {
    return res.status(400).json({ error: 'taskUpdates must be a non-empty array' });
  }

  const visitTaskMap = new Map<number, any>();
  for (const task of visit.tasks || []) {
    const openTaskId = Number(task?.sourceOpenTaskId);
    if (Number.isInteger(openTaskId) && openTaskId > 0) {
      visitTaskMap.set(openTaskId, task);
    }
  }

  if (visitTaskMap.size === 0) {
    return res.status(400).json({ error: 'This visit has no linked open tasks to update' });
  }

  if (taskUpdates.length !== visitTaskMap.size) {
    return res.status(400).json({ error: 'taskUpdates must include every linked visit task exactly once' });
  }

  const normalizedTaskUpdates = [];
  const seenOpenTaskIds = new Set<number>();

  for (const [index, rawTaskUpdate] of taskUpdates.entries()) {
    if (!rawTaskUpdate || typeof rawTaskUpdate !== 'object') {
      return res.status(400).json({ error: `taskUpdates[${index}] is invalid` });
    }

    const openTaskId = rawTaskUpdate.openTaskId;
    if (!Number.isInteger(openTaskId) || !(openTaskId > 0)) {
      return res.status(400).json({ error: `taskUpdates[${index}].openTaskId is required` });
    }
    if (!visitTaskMap.has(openTaskId)) {
      return res.status(400).json({ error: `taskUpdates[${index}].openTaskId does not belong to this visit` });
    }
    if (seenOpenTaskIds.has(openTaskId)) {
      return res.status(400).json({ error: `taskUpdates[${index}].openTaskId is duplicated` });
    }
    seenOpenTaskIds.add(openTaskId);

    const priority = typeof rawTaskUpdate.priority === 'string' ? rawTaskUpdate.priority.trim() : '';
    if (!VALID_OPEN_TASK_PRIORITIES.has(priority)) {
      return res.status(400).json({ error: `taskUpdates[${index}].priority must be one of: high, medium, low` });
    }

    const dueDate = normalizeOptionalDate(rawTaskUpdate.dueDate);
    if (dueDate != null && !isValidIsoDate(dueDate)) {
      return res.status(400).json({ error: `taskUpdates[${index}].dueDate must be YYYY-MM-DD` });
    }

    normalizedTaskUpdates.push({
      openTaskId,
      priority,
      dueDate,
    });
  }

  const performedBy = req.authContext?.userId ?? null;
  const userRole = (req as any).user?.role ?? null;
  const nextOpenTaskStatus = targetStatus === 'needs_reschedule' ? 'needs_reschedule' : 'open';
  const pgClient = await pool.connect();

  try {
    await pgClient.query('BEGIN');

    await pgClient.query(
      `UPDATE marketing_visits
       SET status = $1,
           completed_by = NULL,
           completed_at = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [targetStatus, visit.id],
    );

    for (const taskUpdate of normalizedTaskUpdates) {
      const { rows: openTaskRows } = await pgClient.query(
        `SELECT id, status, priority, due_date
         FROM open_tasks
         WHERE id = $1`,
        [taskUpdate.openTaskId],
      );

      const openTaskRow = openTaskRows[0];
      if (!openTaskRow) {
        throw new Error(`Open task ${taskUpdate.openTaskId} not found`);
      }

      await pgClient.query(
        `UPDATE open_tasks
         SET priority = $1,
             due_date = COALESCE($2::date, due_date),
             status = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [taskUpdate.priority, taskUpdate.dueDate, nextOpenTaskStatus, taskUpdate.openTaskId],
      );

      if (openTaskRow.status !== nextOpenTaskStatus) {
        await pgClient.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
           VALUES ($1, 'status_change', $2, $3, $4, $5)`,
          [taskUpdate.openTaskId, performedBy, userRole, openTaskRow.status, nextOpenTaskStatus],
        );
      }

      if ((openTaskRow.priority ?? null) !== taskUpdate.priority) {
        await pgClient.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
           VALUES ($1, 'priority_changed', $2, $3, $4, $5)`,
          [taskUpdate.openTaskId, performedBy, userRole, openTaskRow.priority ?? null, taskUpdate.priority],
        );
      }

      if (targetStatus === 'needs_reschedule') {
        await pgClient.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, new_value, reason)
           VALUES ($1, 'needs_reschedule', $2, $3, $4, $5)`,
          [taskUpdate.openTaskId, performedBy, userRole, taskUpdate.dueDate, notes],
        );
      }

      if (notes) {
        await pgClient.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, new_value)
           VALUES ($1, 'note_added', $2, $3, $4)`,
          [taskUpdate.openTaskId, performedBy, userRole, notes],
        );
      }
    }

    await pgClient.query('COMMIT');
  } catch (error) {
    await pgClient.query('ROLLBACK');
    throw error;
  } finally {
    pgClient.release();
  }

  const updatedVisit = await loadVisitById(req, String(visit.id));
  return res.json(updatedVisit);
}

async function applyTaskOutcome(req: any, res: any, visit: any, task: any) {
  const outcome = req.body?.outcome as MarketingVisitTaskOutcome | undefined;
  const offers = req.body?.offers as any[] | undefined;
  const offerType = req.body?.offerType as 'cash' | 'installment' | null | undefined;
  const cashOfferAmount = req.body?.cashOfferAmount;
  const installmentAmount = req.body?.installmentAmount;
  const installmentMonths = req.body?.installmentMonths;
  const currency = typeof req.body?.currency === 'string' ? req.body.currency.trim() || null : null;
  const discountPercentage = req.body?.discountPercentage ?? null;
  const closedByEmployeeId = req.body?.closedByEmployeeId;
  const soldDeviceModelId = req.body?.soldDeviceModelId ?? null;
  const offeredDeviceModelId = req.body?.offeredDeviceModelId ?? null;
  const noClosingReason = typeof req.body?.noClosingReason === 'string' ? req.body.noClosingReason.trim() || null : null;
  const cancellationReasonId = req.body?.cancellationReasonId ?? null;
  const rescheduleReasonId = req.body?.rescheduleReasonId ?? null;
  const followUpDueDate = typeof req.body?.followUpDueDate === 'string'
    ? req.body.followUpDueDate.trim() || null
    : null;
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() || null : null;

  const VALID_OUTCOMES = new Set<MarketingVisitTaskOutcome>(['offer_presented', 'device_sold', 'rescheduled', 'cancelled']);
  if (!outcome || !VALID_OUTCOMES.has(outcome)) {
    return res.status(400).json({ error: 'outcome must be one of: offer_presented, device_sold, rescheduled, cancelled' });
  }

    const coreVisitStatus: FieldVisitStatus =
      outcome === 'offer_presented' || outcome === 'device_sold'
        ? 'completed'
        : outcome === 'rescheduled'
        ? 'needs_reschedule'
        : 'cancelled';

  let validatedOffers: MarketingVisitTaskOfferInput[] | null = null;
  if (Array.isArray(offers)) {
    if (offers.length === 0 && outcome === 'offer_presented') {
      return res.status(400).json({ error: 'offers must contain at least one offer for offer_presented' });
    }
    validatedOffers = [];
    for (const [index, rawOffer] of offers.entries()) {
      if (!rawOffer || typeof rawOffer !== 'object') {
        return res.status(400).json({ error: `offers[${index}] is invalid` });
      }
      const currentOfferType = rawOffer.offerType;
      if (currentOfferType !== 'cash' && currentOfferType !== 'installment') {
        return res.status(400).json({ error: `offers[${index}].offerType must be "cash" or "installment"` });
      }
      if (!Number.isInteger(rawOffer.deviceModelId) || !(rawOffer.deviceModelId > 0)) {
        return res.status(400).json({ error: `offers[${index}].deviceModelId is required` });
      }
      const quantity = Number.isInteger(rawOffer.quantity) && rawOffer.quantity > 0 ? rawOffer.quantity : 1;
      if (!(quantity > 0)) {
        return res.status(400).json({ error: `offers[${index}].quantity must be greater than 0` });
      }
      if (typeof rawOffer.totalAmount !== 'number' || !(rawOffer.totalAmount > 0)) {
        return res.status(400).json({ error: `offers[${index}].totalAmount must be greater than 0` });
      }
      const firstPaymentAmount = rawOffer.firstPaymentAmount ?? null;
      const currentInstallmentMonths = rawOffer.installmentMonths ?? null;
      if (currentOfferType === 'installment') {
        if (typeof firstPaymentAmount !== 'number' || !(firstPaymentAmount > 0)) {
          return res.status(400).json({ error: `offers[${index}].firstPaymentAmount must be greater than 0` });
        }
        if (!Number.isInteger(currentInstallmentMonths) || !(currentInstallmentMonths > 0)) {
          return res.status(400).json({ error: `offers[${index}].installmentMonths must be greater than 0` });
        }
      }
      if (currentOfferType === 'installment' && firstPaymentAmount > rawOffer.totalAmount) {
        return res.status(400).json({ error: `offers[${index}].firstPaymentAmount cannot exceed totalAmount` });
      }
      const currentCurrency = typeof rawOffer.currency === 'string' ? rawOffer.currency.trim() : '';
      if (!currentCurrency) {
        return res.status(400).json({ error: `offers[${index}].currency is required` });
      }
      const currentDiscount = rawOffer.discountPercentage ?? null;
      if (
        currentDiscount != null
        && (!Number.isFinite(Number(currentDiscount)) || Number(currentDiscount) < 0 || Number(currentDiscount) > 100)
      ) {
        return res.status(400).json({ error: `offers[${index}].discountPercentage must be between 0 and 100` });
      }
      const currentClosedBy =
        Number.isInteger(rawOffer.closedByEmployeeId) && rawOffer.closedByEmployeeId > 0
          ? rawOffer.closedByEmployeeId
          : null;
      const currentNoClosingReason =
        typeof rawOffer.noClosingReason === 'string' ? rawOffer.noClosingReason.trim() || null : null;
      if (currentClosedBy == null && !currentNoClosingReason) {
        return res.status(400).json({ error: `offers[${index}].closedByEmployeeId or noClosingReason is required` });
      }
      const customerResponse = rawOffer.customerResponse ?? null;
      if (outcome === 'offer_presented' && customerResponse == null) {
        return res.status(400).json({ error: `offers[${index}].customerResponse is required` });
      }
      if (customerResponse != null && !['accepted', 'rejected', 'extension_requested'].includes(customerResponse)) {
        return res.status(400).json({ error: `offers[${index}].customerResponse is invalid` });
      }
      const rejectionReasonId = rawOffer.rejectionReasonId ?? null;
      if (
        outcome === 'offer_presented'
        && customerResponse === 'rejected'
        && (!Number.isInteger(rejectionReasonId) || !(rejectionReasonId > 0))
      ) {
        return res.status(400).json({ error: `offers[${index}].rejectionReasonId is required` });
      }
      const extensionReasonId = rawOffer.extensionReasonId ?? null;
      const extensionDueDate =
        typeof rawOffer.extensionDueDate === 'string' ? rawOffer.extensionDueDate.trim() || null : null;
      if (
        outcome === 'offer_presented'
        && customerResponse === 'extension_requested'
        && (!Number.isInteger(extensionReasonId) || !(extensionReasonId > 0) || !extensionDueDate)
      ) {
        return res.status(400).json({ error: `offers[${index}].extensionReasonId and extensionDueDate are required` });
      }
      if (extensionDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(extensionDueDate)) {
        return res.status(400).json({ error: `offers[${index}].extensionDueDate must be YYYY-MM-DD` });
      }

      validatedOffers.push({
        deviceModelId: rawOffer.deviceModelId,
        offerType: currentOfferType,
        quantity,
        totalAmount: rawOffer.totalAmount,
        firstPaymentAmount: currentOfferType === 'installment' ? firstPaymentAmount : null,
        installmentMonths: currentOfferType === 'installment' ? currentInstallmentMonths : null,
        currency: currentCurrency,
        discountPercentage: currentDiscount != null ? Number(currentDiscount) : null,
        closedByEmployeeId: currentClosedBy,
        noClosingReason: currentClosedBy == null ? currentNoClosingReason : null,
        customerResponse,
        rejectionReasonId: customerResponse === 'rejected' ? rejectionReasonId : null,
        extensionReasonId: customerResponse === 'extension_requested' ? extensionReasonId : null,
        extensionDueDate: customerResponse === 'extension_requested' ? extensionDueDate : null,
        saleReferenceNumber:
          typeof rawOffer.saleReferenceNumber === 'string' ? rawOffer.saleReferenceNumber.trim() || null : null,
      });
    }
  }

  if (outcome === 'offer_presented') {
    if (!Array.isArray(offers)) {
      if (offerType !== 'cash' && offerType !== 'installment') {
        return res.status(400).json({ error: 'offerType is required for offer_presented' });
      }
      if (offerType === 'cash') {
        if (typeof cashOfferAmount !== 'number' || !(cashOfferAmount > 0)) {
          return res.status(400).json({ error: 'cashOfferAmount must be greater than 0' });
        }
      } else {
        if (typeof installmentAmount !== 'number' || !(installmentAmount > 0)) {
          return res.status(400).json({ error: 'installmentAmount must be greater than 0' });
        }
        if (!Number.isInteger(installmentMonths) || !(installmentMonths > 0)) {
          return res.status(400).json({ error: 'installmentMonths must be greater than 0' });
        }
      }
      if (!currency) {
        return res.status(400).json({ error: 'currency is required for offer_presented' });
      }
      const hasCloser = Number.isInteger(closedByEmployeeId) && closedByEmployeeId > 0;
      if (!hasCloser && !noClosingReason) {
        return res.status(400).json({ error: 'closedByEmployeeId or noClosingReason is required for offer_presented' });
      }
      if (!Number.isInteger(offeredDeviceModelId) || !(offeredDeviceModelId > 0)) {
        return res.status(400).json({ error: 'offeredDeviceModelId is required for offer_presented' });
      }
    } else {
      if (validatedOffers == null || validatedOffers.length === 0) {
        return res.status(400).json({ error: 'offers must contain at least one offer for offer_presented' });
      }
    }
  }

  if (outcome === 'device_sold') {
    if (offerType != null) {
      return res.status(400).json({ error: 'offerType is not allowed for device_sold' });
    }
    if (cashOfferAmount != null || installmentAmount != null || installmentMonths != null || currency != null) {
      return res.status(400).json({ error: 'price fields are not allowed for device_sold' });
    }
    if (!Number.isInteger(soldDeviceModelId) || !(soldDeviceModelId > 0)) {
      return res.status(400).json({ error: 'soldDeviceModelId is required for device_sold' });
    }
  }

  if (outcome === 'rescheduled') {
    if (!Number.isInteger(rescheduleReasonId) || !(rescheduleReasonId > 0)) {
      return res.status(400).json({ error: 'rescheduleReasonId is required for rescheduled' });
    }
    if (!followUpDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(followUpDueDate)) {
      return res.status(400).json({ error: 'followUpDueDate must be YYYY-MM-DD for rescheduled' });
    }
  }

  if (outcome === 'cancelled') {
    if (!Number.isInteger(cancellationReasonId) || !(cancellationReasonId > 0)) {
      return res.status(400).json({ error: 'cancellationReasonId is required for cancelled' });
    }
  }

  const completedBy = req.authContext?.userId ?? null;
  const pgClient = await pool.connect();

  try {
    await pgClient.query('BEGIN');

    let saleReferenceNumber: string | null = null;
    if (outcome === 'device_sold') {
      saleReferenceNumber = await generateSaleReferenceNumber(pgClient);
    }

    let legacyResult: MarketingVisitTaskResult | null = null;
    const primaryOffer = validatedOffers?.[0] ?? null;
    const legacyOfferType = outcome === 'offer_presented' ? primaryOffer?.offerType ?? offerType ?? null : null;
    if (outcome === 'offer_presented' && legacyOfferType === 'cash') legacyResult = 'cash_offer_not_closed';
    else if (outcome === 'offer_presented' && legacyOfferType === 'installment') legacyResult = 'installment_offer_not_closed';

    const taskStatus =
      outcome === 'offer_presented' || outcome === 'device_sold'
        ? 'completed'
        : 'not_completed';

    const effectiveCashAmount =
      outcome === 'offer_presented'
      && (primaryOffer?.offerType ?? offerType) === 'cash'
        ? primaryOffer?.totalAmount ?? cashOfferAmount
        : null;
    const effectiveInstallmentAmount =
      outcome === 'offer_presented'
      && (primaryOffer?.offerType ?? offerType) === 'installment'
        ? primaryOffer?.firstPaymentAmount ?? installmentAmount
        : null;
    const effectiveInstallmentMonths =
      outcome === 'offer_presented'
      && (primaryOffer?.offerType ?? offerType) === 'installment'
        ? primaryOffer?.installmentMonths ?? installmentMonths
        : null;
    const effectiveClosedBy =
      outcome === 'device_sold'
        ? Number.isInteger(closedByEmployeeId) && closedByEmployeeId > 0
          ? closedByEmployeeId
          : null
        : outcome === 'offer_presented'
          ? primaryOffer?.closedByEmployeeId
            ?? (Number.isInteger(closedByEmployeeId) && closedByEmployeeId > 0 ? closedByEmployeeId : null)
          : null;
    const effectiveDiscount =
      primaryOffer?.discountPercentage != null
        ? Number(primaryOffer.discountPercentage)
        : discountPercentage != null && Number.isFinite(Number(discountPercentage))
          ? Number(discountPercentage)
          : null;
    const effectiveSoldDevice = outcome === 'device_sold' && soldDeviceModelId ? Number(soldDeviceModelId) : null;
    const effectiveOfferedDevice =
      outcome === 'offer_presented'
        ? primaryOffer?.deviceModelId
          ?? (Number.isInteger(offeredDeviceModelId) && (offeredDeviceModelId as number) > 0 ? offeredDeviceModelId : null)
        : null;
    const hasDiscount = effectiveDiscount != null && effectiveDiscount > 0;
    const isDeviceSold = outcome === 'device_sold';

    await pgClient.query(
      `UPDATE marketing_visit_tasks
       SET outcome = $1,
           offer_type = $2,
           cash_offer_amount = $3,
           installment_amount = $4,
           installment_months = $5,
           closed_by_employee_id = $6,
           result_notes = $7,
           currency = $8,
           discount_percentage = $9,
           sold_device_model_id = $10,
           no_closing_reason = $11,
           cancellation_reason_id = $12,
           reschedule_reason_id = $13,
           sale_reference_number = $14,
           result = $15,
           status = $16,
           follow_up_due_date = $17,
           has_discount = $18,
           is_device_sold = $19,
           offered_device_model_id = $20,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $21 AND visit_id = $22`,
      [
        outcome,
        outcome === 'offer_presented' ? legacyOfferType : null,
        effectiveCashAmount ?? null,
        effectiveInstallmentAmount ?? null,
        effectiveInstallmentMonths ?? null,
        effectiveClosedBy ?? null,
        notes,
        outcome === 'offer_presented' ? primaryOffer?.currency ?? currency : null,
        effectiveDiscount,
        effectiveSoldDevice,
        outcome === 'offer_presented' ? primaryOffer?.noClosingReason ?? noClosingReason : null,
        outcome === 'cancelled' ? cancellationReasonId : null,
        outcome === 'rescheduled' ? rescheduleReasonId : null,
        saleReferenceNumber,
        legacyResult ?? null,
        taskStatus,
        outcome === 'rescheduled' ? followUpDueDate : null,
        hasDiscount,
        isDeviceSold,
        effectiveOfferedDevice,
        task.id,
        visit.id,
      ],
    );

    await pgClient.query(
      'DELETE FROM marketing_visit_task_offers WHERE task_id = $1',
      [task.id],
    );

    if (Array.isArray(validatedOffers) && validatedOffers.length > 0) {
      for (const offer of validatedOffers) {
        await pgClient.query(
          `INSERT INTO marketing_visit_task_offers (
             task_id, device_model_id, offer_type, quantity, total_amount,
             first_payment_amount, installment_months, currency,
             discount_percentage, closed_by_employee_id, no_closing_reason,
             customer_response, rejection_reason_id, extension_reason_id,
             extension_due_date, sale_reference_number, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())`,
          [
            task.id,
            offer.deviceModelId,
            offer.offerType,
            offer.quantity ?? 1,
            offer.totalAmount,
            offer.firstPaymentAmount ?? null,
            offer.installmentMonths ?? null,
            offer.currency,
            offer.discountPercentage ?? null,
            offer.closedByEmployeeId ?? null,
            offer.noClosingReason ?? null,
            offer.customerResponse ?? null,
            offer.rejectionReasonId ?? null,
            offer.extensionReasonId ?? null,
            offer.extensionDueDate ?? null,
            offer.saleReferenceNumber ?? null,
          ],
        );
      }
    }

    const { rows: pendingTaskRows } = await pgClient.query(
      `SELECT COUNT(*) AS count
       FROM marketing_visit_tasks
       WHERE visit_id = $1 AND outcome IS NULL`,
      [visit.id],
    );
    const allTasksHaveOutcome = Number(pendingTaskRows[0]?.count ?? 0) === 0;

    if (allTasksHaveOutcome) {
      const { rows: visitStatusRows } = await pgClient.query(
        `SELECT status
         FROM marketing_visits
         WHERE id = $1`,
        [visit.id],
      );

      if (visitStatusRows[0]?.status === 'ended') {
        await pgClient.query(
          `UPDATE marketing_visits
           SET status = 'completed',
               completed_by = $1,
               completed_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
          [completedBy, visit.id],
        );
      }
    }

    const openTaskId = task.sourceOpenTaskId ?? null;
    let rescheduledOpenTaskId: number | null = null;

    if (openTaskId != null) {
      const { rows: preStatusRows } = await pgClient.query(
        'SELECT status FROM open_tasks WHERE id = $1',
        [openTaskId],
      );
      const oldOpenTaskStatus = preStatusRows[0]?.status ?? null;
      const newOpenTaskStatus =
        outcome === 'cancelled'
          ? 'cancelled'
          : 'completed';

      const openTaskUpdate = await pgClient.query(
        `UPDATE open_tasks SET status = $1, updated_at = NOW()
         WHERE id = $2`,
        [newOpenTaskStatus, openTaskId],
      );

      if ((openTaskUpdate as any).rowCount > 0 && oldOpenTaskStatus && oldOpenTaskStatus !== newOpenTaskStatus) {
        await pgClient.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
           VALUES ($1, 'status_change', $2, NULL, $3, $4)`,
          [openTaskId, completedBy, oldOpenTaskStatus, newOpenTaskStatus],
        );
      }

      if (outcome === 'offer_presented' && Array.isArray(validatedOffers) && validatedOffers.length > 0) {
        await pgClient.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, new_value)
           VALUES ($1, 'offer_presented', $2, NULL, $3)`,
          [openTaskId, completedBy, `${validatedOffers.length} عرض مقدم`],
        );
        const responseParts = validatedOffers
          .filter(o => o.customerResponse)
          .map(o => o.customerResponse === 'accepted' ? 'قبول' : o.customerResponse === 'rejected' ? 'رفض' : 'مهلة');
        if (responseParts.length > 0) {
          await pgClient.query(
            `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, new_value)
             VALUES ($1, 'customer_response', $2, NULL, $3)`,
            [openTaskId, completedBy, responseParts.join(', ')],
          );
        }
      }

      if (outcome === 'rescheduled') {
        const { rows: newTaskRows } = await pgClient.query(
          `INSERT INTO open_tasks (
             client_id,
             branch_id,
             task_type,
             task_family,
             reason,
             status,
             due_date,
             source,
             notes,
             created_by,
             client_snapshot,
             contract_snapshot,
             team_snapshot,
             contact_target_id,
             origin,
             origin_ref_id,
             assigned_scope_id,
             assigned_team_key
           )
           SELECT
             ot.client_id,
             ot.branch_id,
             ot.task_type,
             ot.task_family,
             'follow_up',
             'needs_reschedule',
             $2::date,
             'system',
             $3,
             $4,
             ot.client_snapshot,
             ot.contract_snapshot,
             ot.team_snapshot,
             ot.contact_target_id,
             COALESCE(ot.origin, 'system'),
             ot.id,
             ot.assigned_scope_id,
             ot.assigned_team_key
           FROM open_tasks ot
           WHERE ot.id = $1
           RETURNING id`,
          [openTaskId, followUpDueDate, notes, completedBy],
        );
        rescheduledOpenTaskId = newTaskRows[0]?.id ?? null;
      }
    } else if (outcome === 'rescheduled') {
      const { rows: newTaskRows } = await pgClient.query(
        `INSERT INTO open_tasks (
           client_id,
           branch_id,
           task_type,
           task_family,
           reason,
           status,
           due_date,
           source,
           notes,
           created_by,
           origin
         )
         VALUES ($1, $2, 'device_demo', 'marketing', 'follow_up', 'needs_reschedule', $3::date, 'system', $4, $5, 'system')
         RETURNING id`,
        [visit.clientId, visit.branchId, followUpDueDate, notes, completedBy],
      );
      rescheduledOpenTaskId = newTaskRows[0]?.id ?? null;
    }

    const isFinalized = coreVisitStatus === 'completed' || coreVisitStatus === 'cancelled';

    const { rows: coreVisitRows } = await pgClient.query(
      `INSERT INTO field_visits (
         visit_type, visit_family, status,
         client_id, branch_id,
         scheduled_date, scheduled_time,
         source_legacy_type, source_legacy_id,
         team_snapshot,
         closed_by, closed_at, created_by,
         created_at, updated_at
       ) VALUES (
         'marketing', 'marketing', $1,
         $2, $3,
         $4::date, $5,
         'marketing_visit', $6,
         $7::jsonb,
         $8, $9, $10,
         NOW(), NOW()
       )
       ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET
         status     = EXCLUDED.status,
         closed_by  = EXCLUDED.closed_by,
         closed_at  = EXCLUDED.closed_at,
         updated_at = NOW()
      RETURNING id`,
      [
        coreVisitStatus,
        visit.clientId,
        visit.branchId,
        visit.scheduledDate,
        visit.scheduledTime,
        visit.id,
        visit.teamSnapshot != null ? JSON.stringify(visit.teamSnapshot) : null,
        isFinalized ? completedBy : null,
        isFinalized ? new Date() : null,
        visit.createdBy ?? null,
      ],
    );
    const coreVisitId = coreVisitRows[0].id;

    const sameTypeTasksBefore = (visit.tasks || []).filter((t: any) => t.taskType === task.taskType);
    const taskSequenceNo = sameTypeTasksBefore.findIndex((t: any) => String(t.id) === String(task.id)) + 1;

    const { rows: coreTaskRows } = await pgClient.query(
      `INSERT INTO visit_tasks (
         field_visit_id, source_open_task_id,
         task_type, task_family, sequence_no,
         status, execution_notes,
         source_legacy_type, source_legacy_id,
         created_at, updated_at
       ) VALUES (
         $1, $2,
         'device_demo', 'marketing', $3,
         $4, $5,
         'marketing_visit_task', $6,
         NOW(), NOW()
       )
       ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET
         status              = EXCLUDED.status,
         execution_notes     = EXCLUDED.execution_notes,
         source_open_task_id = COALESCE(EXCLUDED.source_open_task_id, visit_tasks.source_open_task_id),
         updated_at          = NOW()
       RETURNING id`,
      [
        coreVisitId,
        task.sourceOpenTaskId ?? rescheduledOpenTaskId ?? null,
        taskSequenceNo,
        taskStatus,
        notes || null,
        task.id,
      ],
    );
    const coreTaskId = coreTaskRows[0].id;

    const { rows: coreResultRows } = await pgClient.query(
      `INSERT INTO visit_task_results (
         visit_task_id, final_decision, reason_code, closing_notes,
         closed_by, closed_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, NOW(), NOW(), NOW()
       )
       ON CONFLICT (visit_task_id) DO UPDATE SET
         final_decision = EXCLUDED.final_decision,
         reason_code    = EXCLUDED.reason_code,
         closing_notes  = EXCLUDED.closing_notes,
         closed_by      = EXCLUDED.closed_by,
         closed_at      = NOW(),
         updated_at     = NOW()
       RETURNING id`,
      [
        coreTaskId,
        outcome,
        outcome === 'cancelled' ? 'cancelled' : outcome === 'rescheduled' ? 'needs_reschedule' : null,
        notes || null,
        completedBy,
      ],
    );
    const coreResultId = coreResultRows[0].id;

    if (outcome === 'cancelled' || outcome === 'rescheduled') {
      await pgClient.query(
        'DELETE FROM visit_task_device_demo_results WHERE visit_task_result_id = $1',
        [coreResultId],
      );
    } else {
      await pgClient.query(
        `INSERT INTO visit_task_device_demo_results (
           visit_task_result_id,
           offer_type, offer_amount, installment_months,
           closed_by_employee_id,
           discount_percentage,
           sale_reference_number,
           is_device_sold,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (visit_task_result_id) DO UPDATE SET
           offer_type            = EXCLUDED.offer_type,
           offer_amount          = EXCLUDED.offer_amount,
           installment_months    = EXCLUDED.installment_months,
           closed_by_employee_id = EXCLUDED.closed_by_employee_id,
           discount_percentage   = EXCLUDED.discount_percentage,
           sale_reference_number = EXCLUDED.sale_reference_number,
           is_device_sold        = EXCLUDED.is_device_sold,
           updated_at            = NOW()`,
        [
          coreResultId,
          outcome === 'offer_presented' ? offerType : null,
          outcome === 'offer_presented'
            ? (offerType === 'cash' ? cashOfferAmount : installmentAmount)
            : null,
          outcome === 'offer_presented' && offerType === 'installment' ? installmentMonths : null,
          effectiveClosedBy ?? null,
          effectiveDiscount,
          saleReferenceNumber,
          isDeviceSold,
        ],
      );
    }

    await pgClient.query('COMMIT');
  } catch (error) {
    await pgClient.query('ROLLBACK');
    throw error;
  } finally {
    pgClient.release();
  }

  const updatedVisit = await loadVisitById(req, String(visit.id));
  return res.json(updatedVisit);
}

export default router;
