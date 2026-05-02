import { Router } from 'express';
import type { MarketingVisitStatus, MarketingVisitTaskResult } from '@golden-crm/shared';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router();

const RESULT_ALLOWED_STATUSES = new Set<MarketingVisitStatus>([
  'completed',
  'not_completed',
  'postponed_by_company',
  'postponed_by_customer',
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

function getBranchId(req: any): number | null {
  const branchId = req.authContext?.actingBranchId;
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function isGlobalUser(req: any): boolean {
  if (req.authContext?.isSuperAdmin) return true;
  const grants: any[] = req.authContext?.grants || [];
  return grants.some((grant: any) => grant.permission === 'marketing_visits.view' && grant.scope === 'GLOBAL');
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
        status: row.status,
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
      mvt.source_open_task_id AS "sourceOpenTaskId"
    FROM marketing_visits mv
    LEFT JOIN clients c ON c.id = mv.client_id
    LEFT JOIN branches b ON b.id = mv.branch_id
    LEFT JOIN route_assignments ra ON ra.key = mv.team_key
    LEFT JOIN marketing_visit_tasks mvt ON mvt.visit_id = mv.id
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
  return visits[0] ?? null;
}

router.get('/', requirePermission('marketing_visits.view'), async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  const branchId = getBranchId(req);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  if (!isGlobalUser(req) && branchId == null) {
    return res.status(400).json({ error: 'A branch context is required' });
  }

  const params: any[] = [date];
  let whereClause = `WHERE mv.scheduled_date = $1`;

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

  const status = req.body?.status as MarketingVisitStatus | undefined;
  const taskResult = req.body?.taskResult as MarketingVisitTaskResult | undefined;
  const cashOfferAmount = req.body?.cashOfferAmount;
  const installmentAmount = req.body?.installmentAmount;
  const installmentMonths = req.body?.installmentMonths;
  const closedByEmployeeId = req.body?.closedByEmployeeId;
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';

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
        `
          UPDATE marketing_visits
          SET status = $1,
              completed_by = $2,
              completed_at = NOW(),
              updated_at = NOW()
          WHERE id = $3
        `,
        [status, completedBy, visit.id],
      );

      await pgClient.query(
        `
          UPDATE marketing_visit_tasks
          SET status = $1,
              result = $2,
              cash_offer_amount = $3,
              installment_amount = $4,
              installment_months = $5,
              closed_by_employee_id = $6,
              result_notes = $7,
              contract_id = NULL,
              completed_at = NOW(),
              updated_at = NOW()
          WHERE visit_id = $8
            AND task_type = 'device_demo'
        `,
        [
          taskStatus,
          taskResult,
          CASH_RESULTS.has(taskResult!) ? cashOfferAmount : null,
          INSTALLMENT_RESULTS.has(taskResult!) ? installmentAmount : null,
          INSTALLMENT_RESULTS.has(taskResult!) ? installmentMonths : null,
          CLOSED_RESULTS.has(taskResult!) ? closedByEmployeeId : null,
          notes || null,
          visit.id,
        ],
      );
    } else {
      await pgClient.query(
        `
          UPDATE marketing_visits
          SET status = $1,
              completed_by = NULL,
              completed_at = NULL,
              updated_at = NOW()
          WHERE id = $2
        `,
        [status, visit.id],
      );

      await pgClient.query(
        `
          UPDATE marketing_visit_tasks
          SET status = 'not_completed',
              result = NULL,
              cash_offer_amount = NULL,
              installment_amount = NULL,
              installment_months = NULL,
              closed_by_employee_id = NULL,
              result_notes = $1,
              contract_id = NULL,
              completed_at = NOW(),
              updated_at = NOW()
          WHERE visit_id = $2
            AND task_type = 'device_demo'
        `,
        [notes, visit.id],
      );
    }

    // Update linked open_task status based on visit result
    const { rows: taskRows } = await pgClient.query(
      'SELECT source_open_task_id FROM marketing_visit_tasks WHERE visit_id = $1 AND task_type = \'device_demo\'',
      [visit.id],
    );
    const openTaskId = taskRows[0]?.source_open_task_id;
    if (openTaskId != null) {
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
      await pgClient.query(
        'UPDATE open_tasks SET status = $1, updated_at = NOW() WHERE id = $2 AND status IN (\'in_visit\', \'scheduled\', \'in_contact_list\')',
        [newOpenTaskStatus, openTaskId],
      );
    }

    await pgClient.query('COMMIT');
  } catch (error) {
    await pgClient.query('ROLLBACK');
    throw error;
  } finally {
    pgClient.release();
  }

  const updatedVisit = await loadVisitById(req, String(req.params.id));
  return res.json(updatedVisit);
});

export default router;
