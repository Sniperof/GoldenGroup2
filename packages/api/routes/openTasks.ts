import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  buildCustomerOwnershipSelectColumns,
  buildCustomerOwnershipSql,
  mapCustomerOwnership,
} from '../services/customerOwnership.js';

const router = Router();
router.use(requireAuth);

const VALID_TASK_STATUSES = ['open', 'in_contact_list', 'scheduled', 'in_visit', 'completed', 'cancelled', 'needs_reschedule'] as const;

const OPEN_TASK_SELECT = `
  SELECT
    ot.*, 
    ot.client_snapshot AS "clientSnapshot",
    ot.contract_snapshot AS "contractSnapshot",
    ot.team_snapshot AS "teamSnapshot",
    c.name AS "clientName",
    c.mobile AS "clientMobile",
    c.neighborhood AS "clientNeighborhood",
    c.governorate AS "clientGovernorate",
    c.district AS "clientDistrict",
    b.name AS "branchName",
    creator.name AS "createdByName",
    latest_visit.id AS "marketingVisitId",
    latest_visit.status AS "visitStatus",
    latest_visit.scheduled_date AS "scheduledDate",
    latest_visit.scheduled_time AS "scheduledTime",
    COALESCE(
      (SELECT json_agg(json_build_object(
         'userId', u2.id,
         'userName', u2.name,
         'roleDisplayName', COALESCE(r2.display_name, u2.role)
       ) ORDER BY ca.assigned_at)
       FROM client_assignments ca
       JOIN hr_users u2 ON u2.id = ca.hr_user_id
       LEFT JOIN roles r2 ON r2.id = u2.role_id
       WHERE ca.client_id = c.id),
      '[]'::json
    ) AS "assignments",
    ${buildCustomerOwnershipSelectColumns()}
  FROM open_tasks ot
  JOIN clients c ON c.id = ot.client_id
  LEFT JOIN branches b ON b.id = ot.branch_id
  LEFT JOIN branches cb ON cb.id = c.branch_id
  LEFT JOIN hr_users creator ON creator.id = ot.created_by
  LEFT JOIN LATERAL (
    SELECT
      mv.id,
      mv.status,
      mv.scheduled_date,
      mv.scheduled_time
    FROM marketing_visit_tasks mvt
    JOIN marketing_visits mv ON mv.id = mvt.visit_id
    WHERE mvt.source_open_task_id = ot.id
      AND mvt.task_type = 'device_demo'
    ORDER BY mvt.updated_at DESC
    LIMIT 1
  ) latest_visit ON true
  ${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'cb.name' })}
`;

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

function getAuthContext(req: any) {
  if (!req.authContext) {
    throw new Error('AuthContext is required');
  }
  return req.authContext as {
    userId: number;
    isSuperAdmin: boolean;
    actingBranchId: number | null;
    grants: Array<{ key: string; scope: string }>;
    [key: string]: any;
  };
}

function mapOpenTaskRow(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    branchId: row.branch_id,
    taskType: row.task_type,
    taskFamily: row.task_family,
    reason: row.reason,
    status: row.status,
    dueDate: row.due_date,
    priority: row.priority,
    source: row.source,
    marketingVisitTaskId: row.marketing_visit_task_id,
    contactTargetId: row.contact_target_id,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientSnapshot: row.clientSnapshot ?? null,
    contractSnapshot: row.contractSnapshot ?? null,
    teamSnapshot: row.teamSnapshot ?? null,
    clientName: row.clientName ?? null,
    clientMobile: row.clientMobile ?? null,
    clientNeighborhood: row.clientNeighborhood ?? null,
    clientGovernorate: row.clientGovernorate ?? null,
    clientDistrict: row.clientDistrict ?? null,
    branchName: row.branchName ?? null,
    createdByName: row.createdByName ?? null,
    marketingVisitId: row.marketingVisitId ?? null,
    visitStatus: row.visitStatus ?? null,
    scheduledDate: row.scheduledDate ?? null,
    scheduledTime: row.scheduledTime ?? null,
    assignments: row.assignments ?? [],
    ownership: mapCustomerOwnership(row),
  };
}

async function loadOpenTaskById(db: Queryable, id: number) {
  const { rows } = await db.query(`${OPEN_TASK_SELECT} WHERE ot.id = $1`, [id]);
  return rows[0] ? mapOpenTaskRow(rows[0]) : null;
}

function resolveGeoName(value: unknown, geoMap: Map<number, { name: string; level: number; parentId: number | null }>) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return String(value);
  }

  return geoMap.get(parsed)?.name ?? String(value);
}

export async function buildOpenTaskSnapshots(db: Queryable, clientId: number, contractId?: number | null) {
  const { rows: clientRows } = await db.query(
    `SELECT
      c.name,
      c.mobile,
      c.contacts,
      c.detailed_address,
      c.governorate,
      c.district,
      c.neighborhood,
      c.rating,
      c.is_candidate
     FROM clients c
     WHERE c.id = $1`,
    [clientId],
  );

  const clientRow = clientRows[0];
  if (!clientRow) {
    return { clientSnapshot: null, contractSnapshot: null };
  }

  const geoIds = [
    clientRow.governorate,
    clientRow.district,
    clientRow.neighborhood,
  ].filter(Boolean);

  const { rows: baseGeoRows } = geoIds.length > 0
    ? await db.query(
      `SELECT id, name, level, parent_id
       FROM geo_units
       WHERE id = ANY($1::int[])`,
      [geoIds],
    )
    : { rows: [] as any[] };

  const geoMap = new Map<number, { name: string; level: number; parentId: number | null }>(
    baseGeoRows.map((geo: any) => [geo.id, { name: geo.name, level: geo.level, parentId: geo.parent_id }]),
  );

  const missingParentIds = Array.from(
    new Set(
      baseGeoRows
        .map((geo: any) => geo.parent_id)
        .filter((parentId: number | null) => parentId && !geoMap.has(parentId)),
    ),
  );

  if (missingParentIds.length > 0) {
    const { rows: parentGeoRows } = await db.query(
      `SELECT id, name, level, parent_id
       FROM geo_units
       WHERE id = ANY($1::int[])`,
      [missingParentIds],
    );

    for (const geo of parentGeoRows) {
      geoMap.set(geo.id, { name: geo.name, level: geo.level, parentId: geo.parent_id });
    }
  }

  const neighborhoodId = typeof clientRow.neighborhood === 'number'
    ? clientRow.neighborhood
    : Number.parseInt(String(clientRow.neighborhood), 10);
  const neighborhoodUnit = Number.isNaN(neighborhoodId) ? null : geoMap.get(neighborhoodId);

  const clientSnapshot = {
    name: clientRow.name ?? '',
    mobile: clientRow.mobile ?? '',
    contacts: clientRow.contacts || [],
    address: {
      governorate: resolveGeoName(clientRow.governorate, geoMap) ?? '',
      district: resolveGeoName(clientRow.district, geoMap) ?? '',
      subArea: neighborhoodUnit?.parentId ? (geoMap.get(neighborhoodUnit.parentId)?.name ?? '') : '',
      neighborhood: resolveGeoName(clientRow.neighborhood, geoMap) ?? '',
      detailed: clientRow.detailed_address ?? '',
    },
    rating: clientRow.rating || 'Undefined',
    clientType: clientRow.is_candidate ? 'Candidate' : 'Client',
  };

  let contractSnapshot = null;
  if (contractId) {
    const { rows: contractRows } = await db.query(
      `SELECT
        c.contract_number,
        c.device_model_name,
        c.serial_number,
        c.installation_date,
        c.status
       FROM contracts c
       WHERE c.id = $1`,
      [contractId],
    );

    if (contractRows[0]) {
      contractSnapshot = {
        contractNumber: contractRows[0].contract_number ?? '',
        deviceModel: contractRows[0].device_model_name ?? '',
        serialNumber: contractRows[0].serial_number ?? '',
        installationDate: contractRows[0].installation_date ?? '',
        status: contractRows[0].status ?? '',
      };
    }
  }

  return { clientSnapshot, contractSnapshot };
}

export async function persistOpenTaskSnapshots(db: Queryable, openTaskId: number, clientId: number, contractId?: number | null) {
  const { clientSnapshot, contractSnapshot } = await buildOpenTaskSnapshots(db, clientId, contractId);

  await db.query(
    `UPDATE open_tasks
     SET client_snapshot = $1::jsonb,
         contract_snapshot = $2::jsonb
     WHERE id = $3`,
    [
      clientSnapshot ? JSON.stringify(clientSnapshot) : null,
      contractSnapshot ? JSON.stringify(contractSnapshot) : null,
      openTaskId,
    ],
  );
}

// GET /open-tasks — list open tasks filtered by branch_id (required), status, task_type
// TODO: replace with dedicated open_tasks permissions when created
router.get('/', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);

    let branchId: number;
    if (authContext.isSuperAdmin) {
      const qb = Number(req.query.branchId);
      if (!qb || !Number.isFinite(qb)) {
        return res.status(400).json({ error: 'يجب تحديد الفرع' });
      }
      branchId = qb;
    } else {
      if (!authContext.actingBranchId) {
        return res.status(400).json({ error: 'يجب تحديد الفرع' });
      }
      branchId = authContext.actingBranchId;
    }

    const statusFilter = req.query.status as string | undefined;
    const taskTypeFilter = req.query.taskType as string | undefined;

    const params: any[] = [branchId];
    let paramIdx = 2;

    let statusCondition = '';
    if (statusFilter) {
      statusCondition = `AND ot.status = $${paramIdx}`;
      params.push(statusFilter);
      paramIdx++;
    }

    let taskTypeCondition = '';
    if (taskTypeFilter) {
      taskTypeCondition = `AND ot.task_type = $${paramIdx}`;
      params.push(taskTypeFilter);
      paramIdx++;
    }

    const query = `
      ${OPEN_TASK_SELECT}
      WHERE ot.branch_id = $1
        ${statusCondition}
        ${taskTypeCondition}
      ORDER BY ot.created_at DESC
    `;

    const { rows } = await pool.query(query, params);
    res.json(rows.map(mapOpenTaskRow));
  } catch (err: any) {
    console.error('[open-tasks] GET / error:', err);
    res.status(500).json({ error: 'فشل في تحميل المهام' });
  }
});

router.post('/', requirePermission('marketing_visits.update_result'), async (req, res) => {
  const authContext = getAuthContext(req);
  const clientId = Number(req.body?.clientId);
  const branchId = Number(req.body?.branchId ?? authContext.actingBranchId);
  const dueDate = req.body?.dueDate ?? null;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() || null : null;
  const priority = ['high', 'medium', 'low'].includes(req.body?.priority) ? req.body.priority : null;
  const devices = req.body?.devices as any[] | undefined;
  const preOffers = req.body?.preOffers as any[] | undefined;

  if (!clientId || !Number.isInteger(clientId)) {
    return res.status(400).json({ error: 'clientId is required' });
  }
  if (!branchId || !Number.isInteger(branchId)) {
    return res.status(400).json({ error: 'branchId is required' });
  }

  const { rows: reasonRows } = await pool.query(
    `SELECT value
     FROM system_lists
     WHERE category = $1 AND is_active = TRUE
     ORDER BY display_order ASC, id ASC`,
    ['open_task_reasons'],
  );
  const allowedReasons = new Set(
    reasonRows.length > 0
      ? reasonRows.map((row: any) => String(row.value).trim()).filter((value: string) => value.length > 0)
      : ['new_lead', 'follow_up', 'renewal', 'service_request', 'other'],
  );
  if (!reason || !allowedReasons.has(reason)) {
    return res.status(400).json({ error: 'reason is required and must be selected from system lists' });
  }

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    const { rows: taskRows } = await pgClient.query(
      `INSERT INTO open_tasks (
         client_id, branch_id, task_type, task_family, reason, status,
         due_date, priority, source, notes, created_by, origin
       ) VALUES ($1, $2, 'device_demo', 'marketing', $3, 'open',
         $4::date, $5, 'manual', $6, $7, 'manual_entry')
       RETURNING id`,
      [clientId, branchId, reason, dueDate, priority, notes, authContext.userId ?? null],
    );
    const openTaskId = taskRows[0].id;

    if (Array.isArray(devices) && devices.length > 0) {
      for (const device of devices) {
        const deviceModelId = Number(device.deviceModelId);
        if (!Number.isInteger(deviceModelId) || deviceModelId <= 0) continue;
        const quantity = Number(device.quantity) || 1;
        const { rows: dmRows } = await pgClient.query(
          'SELECT name_ar, name FROM device_models WHERE id = $1',
          [deviceModelId],
        );
        const deviceName = dmRows[0]?.name_ar || dmRows[0]?.name || `جهاز #${deviceModelId}`;
        await pgClient.query(
          `INSERT INTO open_task_devices (task_id, device_model_id, device_name_snapshot, quantity)
           VALUES ($1, $2, $3, $4)`,
          [openTaskId, deviceModelId, deviceName, quantity > 0 ? quantity : 1],
        );
      }
    }

    if (Array.isArray(preOffers) && preOffers.length > 0) {
      for (const offer of preOffers) {
        await pgClient.query(
          `INSERT INTO open_task_pre_offers (
             open_task_id, device_model_id, offer_type, quantity, total_amount,
             first_payment_amount, installment_months, currency,
             discount_percentage, closed_by_employee_id, no_closing_reason
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            openTaskId,
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
          ],
        );
      }
    }

    await persistOpenTaskSnapshots(pgClient, openTaskId, clientId, null);
    await pgClient.query('COMMIT');
    return res.json({ id: openTaskId, success: true });
  } catch (err: any) {
    await pgClient.query('ROLLBACK');
    return res.status(500).json({ error: err.message });
  } finally {
    pgClient.release();
  }
});

router.get('/client/:clientId', requirePermission('marketing_visits.view'), async (req, res) => {
  const authContext = getAuthContext(req);
  const clientId = Number(req.params.clientId);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'clientId is invalid' });
  }

  const branchId = authContext.actingBranchId;
  let whereClause = 'WHERE ot.client_id = $1';
  const params: any[] = [clientId];

  if (!authContext.isSuperAdmin && branchId != null) {
    whereClause += ' AND ot.branch_id = $2';
    params.push(branchId);
  }

  const { rows } = await pool.query(
    `SELECT
       ot.id,
       ot.task_type AS "taskType",
       ot.task_family AS "taskFamily",
       ot.reason,
       ot.status,
       ot.due_date AS "dueDate",
       ot.notes,
       ot.created_at AS "createdAt",
       ot.updated_at AS "updatedAt",
       ot.client_snapshot AS "clientSnapshot",
       ot.assigned_scope_id AS "assignedScopeId",
       ot.assigned_team_key AS "assignedTeamKey",
       COALESCE(
         (SELECT json_agg(json_build_object(
           'id', otd.id,
           'deviceModelId', otd.device_model_id,
           'deviceName', otd.device_name_snapshot,
           'quantity', otd.quantity
         )) FROM open_task_devices otd WHERE otd.task_id = ot.id),
         '[]'::json
       ) AS "devices",
       COALESCE(
         (SELECT json_agg(json_build_object(
           'id', otpo.id,
           'deviceModelId', otpo.device_model_id,
           'offerType', otpo.offer_type,
           'quantity', otpo.quantity,
           'totalAmount', otpo.total_amount,
           'firstPaymentAmount', otpo.first_payment_amount,
           'installmentMonths', otpo.installment_months,
           'currency', otpo.currency,
           'discountPercentage', otpo.discount_percentage
         )) FROM open_task_pre_offers otpo WHERE otpo.open_task_id = ot.id),
         '[]'::json
       ) AS "preOffers"
     FROM open_tasks ot
     ${whereClause}
     ORDER BY ot.created_at DESC`,
    params,
  );

  return res.json(rows);
});

// GET /open-tasks/device-demo — device demo operational workspace
// Returns device_demo open tasks joined with their latest marketing visit and task result.
// Filters: status (open task status), visitStatus, scheduledDate, branchId
router.get('/device-demo', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);

    let branchId: number;
    if (authContext.isSuperAdmin) {
      const qb = Number(req.query.branchId);
      if (!qb || !Number.isFinite(qb)) {
        return res.status(400).json({ error: 'يجب تحديد الفرع' });
      }
      branchId = qb;
    } else {
      if (!authContext.actingBranchId) {
        return res.status(400).json({ error: 'يجب تحديد الفرع' });
      }
      branchId = authContext.actingBranchId;
    }

    const statusFilter = req.query.status as string | undefined;
    const visitStatusFilter = req.query.visitStatus as string | undefined;
    const scheduledDateFilter = req.query.scheduledDate as string | undefined;
    const scheduledFilter = req.query.scheduled as string | undefined; // 'yes' | 'no'

    const params: any[] = [branchId];
    let paramIdx = 2;
    const conditions: string[] = [];

    if (statusFilter) {
      conditions.push(`ot.status = $${paramIdx}`);
      params.push(statusFilter);
      paramIdx++;
    }

    if (visitStatusFilter) {
      conditions.push(`mv.status = $${paramIdx}`);
      params.push(visitStatusFilter);
      paramIdx++;
    }

    if (scheduledDateFilter) {
      conditions.push(`mv.scheduled_date = $${paramIdx}`);
      params.push(scheduledDateFilter);
      paramIdx++;
    }

    if (scheduledFilter === 'yes') {
      conditions.push(`mv.id IS NOT NULL`);
    } else if (scheduledFilter === 'no') {
      conditions.push(`mv.id IS NULL`);
    }

    const whereExtra = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT
        ot.id,
        ot.status AS "taskStatus",
        ot.task_type AS "taskType",
        ot.reason,
        ot.task_family AS "taskFamily",
        ot.created_at AS "createdAt",
        ot.updated_at AS "updatedAt",
        ot.client_id AS "clientId",
        ot.team_snapshot AS "teamSnapshot",
        ot.client_snapshot AS "clientSnapshot",
        c.name AS "clientName",
        c.mobile AS "clientMobile",
        c.neighborhood AS "clientNeighborhood",
        c.governorate AS "clientGovernorate",
        c.district AS "clientDistrict",
        c.detailed_address AS "clientDetailedAddress",
        mv.id AS "marketingVisitId",
        mv.status AS "visitStatus",
        mv.scheduled_date AS "scheduledDate",
        mv.scheduled_time AS "scheduledTime",
        mv.requested_device_name AS "requestedDeviceName",
        mv.requested_device_model_id AS "requestedDeviceModelId",
        mv.team_snapshot AS "visitTeamSnapshot",
        mv.customer_name AS "customerName",
        mv.customer_mobile AS "customerMobile",
        mv.customer_address AS "customerAddress",
        mvt.result AS "latestResult",
        mvt.status AS "visitTaskStatus"
      FROM open_tasks ot
      JOIN clients c ON c.id = ot.client_id
      LEFT JOIN LATERAL (
        SELECT mvt2.result, mvt2.status, mvt2.visit_id
        FROM marketing_visit_tasks mvt2
        WHERE mvt2.source_open_task_id = ot.id
          AND mvt2.task_type = 'device_demo'
        ORDER BY mvt2.updated_at DESC
        LIMIT 1
      ) mvt ON true
      LEFT JOIN marketing_visits mv ON mv.id = mvt.visit_id
      WHERE ot.branch_id = $1
        AND ot.task_type = 'device_demo'
        ${whereExtra}
      ORDER BY ot.created_at DESC
    `;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err: any) {
    console.error('[open-tasks] GET /device-demo error:', err);
    res.status(500).json({ error: 'فشل في تحميل مهام عروض الأجهزة' });
  }
});

// POST /open-tasks/:id/assign-team — assign snapshot team and schedule task
router.post('/:id/assign-team', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'معرف المهمة غير صالح' });
    }

    const { rows: existing } = await pool.query('SELECT branch_id, status FROM open_tasks WHERE id = $1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }
    if (!authContext.isSuperAdmin && existing[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }
    const oldStatus = existing[0].status;

    const employeeIds = [req.body.supervisorId, req.body.technicianId, req.body.traineeId]
      .filter((value): value is number => Number.isFinite(Number(value)))
      .map(Number);

    const { rows: employeeRows } = employeeIds.length > 0
      ? await pool.query(
        'SELECT id, name FROM employees WHERE id = ANY($1::int[])',
        [employeeIds],
      )
      : { rows: [] as any[] };

    const employeeMap = new Map<number, string>(employeeRows.map((employee: any) => [employee.id, employee.name]));

    const teamSnapshot = {
      supervisor: req.body.supervisorId
        ? { id: Number(req.body.supervisorId), name: employeeMap.get(Number(req.body.supervisorId)) || '' }
        : undefined,
      technician: req.body.technicianId
        ? { id: Number(req.body.technicianId), name: employeeMap.get(Number(req.body.technicianId)) || '' }
        : undefined,
      trainee: req.body.traineeId
        ? { id: Number(req.body.traineeId), name: employeeMap.get(Number(req.body.traineeId)) || '' }
        : undefined,
      assignedAt: new Date().toISOString(),
    };

    await pool.query(
      `UPDATE open_tasks
       SET team_snapshot = $1::jsonb,
           status = 'scheduled',
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(teamSnapshot), id],
    );

    // Log status change to activity log
    if (oldStatus !== 'scheduled') {
      const userRole = (req as any).user?.role ?? null;
      await pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
         VALUES ($1, 'status_change', $2, $3, $4, 'scheduled')`,
        [id, authContext.userId, userRole, oldStatus],
      );
    }

    // Log team assignment
    const userRole = (req as any).user?.role ?? null;
    await pool.query(
      `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, new_value)
       VALUES ($1, 'team_assigned', $2, $3, $4)`,
      [id, authContext.userId, userRole, JSON.stringify(teamSnapshot)],
    );

    const task = await loadOpenTaskById(pool, id);
    res.json(task);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/assign-team error:', err);
    res.status(500).json({ error: 'فشل في تعيين الفريق' });
  }
});

// GET /open-tasks/:id — single task
// TODO: replace with dedicated open_tasks permissions when created
router.get('/:id', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'معرف المهمة غير صالح' });
    }

    const { rows } = await pool.query(`${OPEN_TASK_SELECT} WHERE ot.id = $1`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }

    const row = rows[0];
    if (!authContext.isSuperAdmin && row.branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const taskData = mapOpenTaskRow(row);
    const ts = taskData.teamSnapshot;
    if (ts && typeof ts === 'object' && (ts.supervisorEmployeeId !== undefined || ts.technicianEmployeeId !== undefined)) {
      const idList = [ts.supervisorEmployeeId, ts.technicianEmployeeId, ts.traineeEmployeeId]
        .filter((eid: any): eid is number => eid != null && Number.isFinite(Number(eid)))
        .map(Number);
      const { rows: empRows } = idList.length > 0
        ? await pool.query('SELECT id, name FROM employees WHERE id = ANY($1::int[])', [idList])
        : { rows: [] as any[] };
      const empMap = new Map<number, string>(empRows.map((e: any) => [e.id, e.name]));
      taskData.teamSnapshot = {
        supervisor: ts.supervisorEmployeeId != null ? { id: Number(ts.supervisorEmployeeId), name: empMap.get(Number(ts.supervisorEmployeeId)) ?? '' } : null,
        technician: ts.technicianEmployeeId != null ? { id: Number(ts.technicianEmployeeId), name: empMap.get(Number(ts.technicianEmployeeId)) ?? '' } : null,
        trainee: ts.traineeEmployeeId != null ? { id: Number(ts.traineeEmployeeId), name: empMap.get(Number(ts.traineeEmployeeId)) ?? '' } : null,
        assignedAt: ts.assignedAt ?? null,
      };
    }

    async function loadResultData(mvtId: number) {
      const { rows: mvtRows } = await pool.query(
        `SELECT
          mvt.result,
          mvt.status AS "resultStatus",
          mvt.cash_offer_amount AS "cashOfferAmount",
          mvt.installment_amount AS "installmentAmount",
          mvt.installment_months AS "installmentMonths",
          mvt.currency,
          mvt.discount_percentage AS "discountPercentage",
          mvt.closed_by_employee_id AS "closedByEmployeeId",
          closer.name AS "closedByEmployeeName",
          mvt.result_notes AS "resultNotes",
          mvt.no_closing_reason AS "noClosingReason",
          mvt.sold_device_model_id AS "soldDeviceModelId",
          dm.name AS "soldDeviceModelName",
          mvt.contract_id AS "contractId",
          mvt.completed_at AS "completedAt",
          mvt.outcome,
          mvt.offer_type AS "offerType",
          mvt.has_discount AS "hasDiscount",
          mvt.is_device_sold AS "isDeviceSold",
          mvt.sale_reference_number AS "saleReferenceNumber",
          mvt.follow_up_due_date AS "followUpDueDate",
          mvt.cancellation_reason_id AS "cancellationReasonId",
          cancel_reason.value AS "cancellationReasonName",
          mvt.reschedule_reason_id AS "rescheduleReasonId",
          reschedule_reason.value AS "rescheduleReasonName",
          mvt.cancellation_reason AS "cancellationReason",
          mvt.reschedule_reason AS "rescheduleReason"
        FROM marketing_visit_tasks mvt
        LEFT JOIN employees closer ON closer.id = mvt.closed_by_employee_id
        LEFT JOIN device_models dm ON dm.id = mvt.sold_device_model_id
        LEFT JOIN system_lists cancel_reason ON cancel_reason.id = mvt.cancellation_reason_id
        LEFT JOIN system_lists reschedule_reason ON reschedule_reason.id = mvt.reschedule_reason_id
        WHERE mvt.id = $1`,
        [mvtId],
      );
      if (mvtRows[0]) {
        Object.assign(taskData, mvtRows[0]);
        // Load actual offers submitted during the visit
        const { rows: offerRows } = await pool.query(
          `SELECT
            mvto.id,
            mvto.device_model_id AS "deviceModelId",
            COALESCE(dm2.name_ar, dm2.name) AS "deviceName",
            mvto.offer_type AS "offerType",
            mvto.quantity,
            mvto.total_amount::float AS "totalAmount",
            mvto.currency,
            mvto.discount_percentage::float AS "discountPercentage",
            mvto.no_closing_reason AS "noClosingReason",
            e.name AS "closedByEmployeeName",
            mvto.customer_response AS "customerResponse"
          FROM marketing_visit_task_offers mvto
          LEFT JOIN device_models dm2 ON dm2.id = mvto.device_model_id
          LEFT JOIN employees e ON e.id = mvto.closed_by_employee_id
          WHERE mvto.task_id = $1
          ORDER BY mvto.id`,
          [mvtId],
        );
        (taskData as any).offers = offerRows;
      }
    }

    // Try to find result data only from the task linked to THIS open task.
    if (taskData.marketingVisitTaskId) {
      await loadResultData(Number(taskData.marketingVisitTaskId));
    } else if (taskData.marketingVisitId) {
      const { rows: linkRows } = await pool.query(
        `SELECT id
         FROM marketing_visit_tasks
         WHERE visit_id = $1
           AND task_type = 'device_demo'
           AND source_open_task_id = $2
         ORDER BY updated_at DESC
         LIMIT 1`,
        [taskData.marketingVisitId, id],
      );
      if (linkRows[0]) {
        await loadResultData(linkRows[0].id);
      }
    }

    // Load pre-offers defined at task creation
    const { rows: preOfferRows } = await pool.query(
      `SELECT
        otpo.id AS id,
        otpo.device_model_id AS "deviceModelId",
        COALESCE(dm.name_ar, dm.name) AS "deviceName",
        otpo.offer_type AS "offerType",
        otpo.quantity,
        otpo.total_amount::float AS "totalAmount",
        otpo.first_payment_amount::float AS "firstPaymentAmount",
        otpo.installment_months AS "installmentMonths",
        otpo.currency,
        otpo.discount_percentage::float AS "discountPercentage",
        otpo.closed_by_employee_id AS "closedByEmployeeId",
        otpo.no_closing_reason AS "noClosingReason"
      FROM open_task_pre_offers otpo
      LEFT JOIN device_models dm ON dm.id = otpo.device_model_id
      WHERE otpo.open_task_id = $1
      ORDER BY otpo.id`,
      [id],
    );
    (taskData as any).preOffers = preOfferRows;

    res.json(taskData);
  } catch (err: any) {
    console.error('[open-tasks] GET /:id error:', err);
    res.status(500).json({ error: 'فشل في تحميل المهمة' });
  }
});

// PATCH /open-tasks/:id — update status, notes, dueDate, priority
// TODO: replace with dedicated open_tasks permissions when created
router.patch('/:id', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'معرف المهمة غير صالح' });
    }

    if (req.body.status !== undefined && !(VALID_TASK_STATUSES as readonly string[]).includes(req.body.status)) {
      return res.status(400).json({ error: 'حالة المهمة غير صالحة' });
    }

    if (req.body.dueDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}/.test(String(req.body.dueDate)) || isNaN(Date.parse(req.body.dueDate))) {
        return res.status(400).json({ error: 'تاريخ الاستحقاق غير صالح' });
      }
    }

    const VALID_PRIORITIES = ['high', 'medium', 'low'];
    if (req.body.priority !== undefined && req.body.priority !== null && !VALID_PRIORITIES.includes(req.body.priority)) {
      return res.status(400).json({ error: 'قيمة الأولوية غير صالحة' });
    }

    const { rows: existing } = await pool.query('SELECT branch_id, status, priority FROM open_tasks WHERE id = $1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }
    if (!authContext.isSuperAdmin && existing[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }
    const oldStatus = existing[0].status;

    const fieldMap: Record<string, string> = {
      status: 'status',
      notes: 'notes',
      dueDate: 'due_date',
      priority: 'priority',
    };
    const allowedFields = ['status', 'notes', 'dueDate', 'priority'];

    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${fieldMap[field]} = $${paramIdx}`);
        values.push(req.body[field]);
        paramIdx++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    const updateQuery = `UPDATE open_tasks SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id`;
    const { rows: [updated] } = await pool.query(updateQuery, values);

    if (!updated) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }

    const performedBy = authContext.userId;
    const userRole = (req as any).user?.role ?? null;
    const activityPromises: Promise<any>[] = [];

    if (req.body.status !== undefined && req.body.status !== oldStatus) {
      activityPromises.push(pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
         VALUES ($1, 'status_change', $2, $3, $4, $5)`,
        [id, performedBy, userRole, oldStatus, req.body.status],
      ));
    }

    if (req.body.notes !== undefined) {
      activityPromises.push(pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, new_value)
         VALUES ($1, 'note_added', $2, $3, $4)`,
        [id, performedBy, userRole, req.body.notes],
      ));
    }

    if (req.body.priority !== undefined && req.body.priority !== (existing[0].priority ?? null)) {
      activityPromises.push(pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
         VALUES ($1, 'priority_changed', $2, $3, $4, $5)`,
        [id, performedBy, userRole, existing[0].priority ?? null, req.body.priority],
      ));
    }

    if (activityPromises.length > 0) {
      await Promise.all(activityPromises);
    }

    const task = await loadOpenTaskById(pool, updated.id);
    res.json(task);
  } catch (err: any) {
    console.error('[open-tasks] PATCH /:id error:', err);
    res.status(500).json({ error: 'فشل في تحديث المهمة' });
  }
});

// ── Finalization rule helper ───────────────────────────────────────────────────
// After a visit_task_result is written, set field_visit.status = 'completed'
// only when every visit_task belonging to that field_visit has a result.
async function maybeCompleteFieldVisit(db: Queryable, fieldVisitId: bigint | string) {
  await db.query(
    `UPDATE field_visits fv
     SET status = 'completed', updated_at = NOW()
     WHERE fv.id = $1
       AND fv.status != 'completed'
       AND NOT EXISTS (
         SELECT 1 FROM visit_tasks vt
         LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
         WHERE vt.field_visit_id = fv.id
           AND vtr.id IS NULL
       )`,
    [fieldVisitId],
  );
}

function mapDecisionToOpenTaskStatus(finalDecision: string): string {
  if (finalDecision === 'resolved') return 'completed';
  if (finalDecision === 'cancelled') return 'cancelled';
  return 'needs_reschedule'; // partially_resolved | unresolved | needs_followup
}

// GET /open-tasks/:id/emergency-result — fetch recorded emergency result
router.get('/:id/emergency-result', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query(
      'SELECT branch_id, task_type FROM open_tasks WHERE id = $1',
      [id],
    );
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (taskRows[0].task_type !== 'emergency_maintenance') {
      return res.status(400).json({ error: 'هذا المسار مخصص لمهام الصيانة الطارئة فقط' });
    }
    if (!authContext.isSuperAdmin && taskRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    const { rows } = await pool.query(
      `SELECT
         fv.id              AS "fieldVisitId",
         vt.id              AS "visitTaskId",
         vtr.id             AS "resultId",
         vtr.final_decision AS "finalDecision",
         vtr.reason_code    AS "reasonCode",
         vtr.closing_notes  AS "closingNotes",
         vtr.closed_at      AS "closedAt",
         ts.problem_confirmed     AS "problemConfirmed",
         ts.technical_notes       AS "technicalNotes",
         ts.water_tds_before      AS "waterTdsBefore",
         ts.water_tds_after       AS "waterTdsAfter",
         ts.pump_pressure         AS "pumpPressure",
         ts.membrane_output       AS "membraneOutput",
         ts.tank_pressure         AS "tankPressure",
         ts.low_pressure_switch   AS "lowPressureSwitch",
         ts.high_pressure_switch  AS "highPressureSwitch",
         ts.solenoid_valve        AS "solenoidValve",
         ts.uv_status             AS "uvStatus",
         ef.labor_cost            AS "laborCost",
         ef.parts_cost            AS "partsCost",
         ef.total_cost            AS "totalCost",
         ef.payment_method        AS "paymentMethod",
         ef.collected_amount      AS "collectedAmount",
         ef.invoice_notes         AS "invoiceNotes"
       FROM field_visits fv
       JOIN visit_tasks vt
         ON vt.field_visit_id = fv.id
         AND vt.source_legacy_type = 'open_task'
         AND vt.source_legacy_id = $1::text
       LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
       LEFT JOIN visit_task_emergency_technical_states ts ON ts.visit_task_result_id = vtr.id
       LEFT JOIN visit_task_emergency_financials ef ON ef.visit_task_result_id = vtr.id
       WHERE fv.source_legacy_type = 'open_task'
         AND fv.source_legacy_id = $1::text`,
      [id],
    );

    if (rows.length === 0) {
      return res.json({ fieldVisitId: null, visitTaskId: null, visitTaskResult: null, technicalState: null, partsUsed: [], financials: null });
    }

    const row = rows[0];

    const { rows: partsRows } = row.resultId ? await pool.query(
      `SELECT
         id,
         spare_part_id      AS "sparePartId",
         part_name_snapshot AS "partNameSnapshot",
         quantity,
         unit_price         AS "unitPrice"
       FROM visit_task_emergency_parts_used
       WHERE visit_task_result_id = $1
       ORDER BY id`,
      [row.resultId],
    ) : { rows: [] };

    return res.json({
      fieldVisitId: row.fieldVisitId,
      visitTaskId: row.visitTaskId,
      visitTaskResult: row.resultId ? {
        id: row.resultId,
        finalDecision: row.finalDecision,
        reasonCode: row.reasonCode,
        closingNotes: row.closingNotes,
        closedAt: row.closedAt,
      } : null,
      technicalState: row.problemConfirmed !== null || row.technicalNotes !== null ? {
        problemConfirmed: row.problemConfirmed,
        technicalNotes: row.technicalNotes,
        waterTdsBefore: row.waterTdsBefore != null ? Number(row.waterTdsBefore) : null,
        waterTdsAfter: row.waterTdsAfter != null ? Number(row.waterTdsAfter) : null,
        pumpPressure: row.pumpPressure != null ? Number(row.pumpPressure) : null,
        membraneOutput: row.membraneOutput,
        tankPressure: row.tankPressure != null ? Number(row.tankPressure) : null,
        lowPressureSwitch: row.lowPressureSwitch,
        highPressureSwitch: row.highPressureSwitch,
        solenoidValve: row.solenoidValve,
        uvStatus: row.uvStatus,
      } : null,
      partsUsed: partsRows.map((p: any) => ({
        id: p.id,
        sparePartId: p.sparePartId,
        partNameSnapshot: p.partNameSnapshot,
        quantity: p.quantity,
        unitPrice: p.unitPrice != null ? Number(p.unitPrice) : null,
      })),
      financials: row.laborCost !== null || row.partsCost !== null || row.totalCost !== null ? {
        laborCost: row.laborCost != null ? Number(row.laborCost) : null,
        partsCost: row.partsCost != null ? Number(row.partsCost) : null,
        totalCost: row.totalCost != null ? Number(row.totalCost) : null,
        paymentMethod: row.paymentMethod,
        collectedAmount: row.collectedAmount != null ? Number(row.collectedAmount) : null,
        invoiceNotes: row.invoiceNotes,
      } : null,
    });
  } catch (err: any) {
    console.error('[open-tasks] GET /:id/emergency-result error:', err);
    res.status(500).json({ error: 'فشل في تحميل نتيجة المهمة' });
  }
});

// POST /open-tasks/:id/emergency-result — record or update emergency maintenance result
// Phase 4 finalization rule: task is only resolved when result is recorded here.
router.post('/:id/emergency-result', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const VALID_DECISIONS = ['resolved', 'partially_resolved', 'unresolved', 'needs_followup', 'cancelled'] as const;
    const finalDecision: string = req.body?.finalDecision;
    if (!finalDecision || !(VALID_DECISIONS as readonly string[]).includes(finalDecision)) {
      return res.status(400).json({ error: `finalDecision مطلوب ويجب أن يكون أحد: ${VALID_DECISIONS.join(', ')}` });
    }
    const closingNotes: string | null = typeof req.body?.closingNotes === 'string' ? req.body.closingNotes.trim() || null : null;

    const { rows: taskRows } = await pool.query(
      'SELECT id, branch_id, task_type, client_id FROM open_tasks WHERE id = $1',
      [id],
    );
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (taskRows[0].task_type !== 'emergency_maintenance') {
      return res.status(400).json({ error: 'هذا المسار مخصص لمهام الصيانة الطارئة فقط' });
    }
    if (!authContext.isSuperAdmin && taskRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    const taskRow = taskRows[0];
    const closedBy: number | null = authContext.userId ?? null;
    const technicalState = req.body?.technicalState ?? null;
    const partsUsed: any[] = Array.isArray(req.body?.partsUsed) ? req.body.partsUsed : [];
    const financials = req.body?.financials ?? null;

    const db = await pool.connect();
    try {
      await db.query('BEGIN');

      // 1. Upsert field_visit — set to 'ended' (field work done, result being recorded).
      // maybeCompleteFieldVisit() (step 7) will promote to 'completed' once all
      // visit_tasks have results. For single-task visits this happens immediately.
      const { rows: fvRows } = await db.query(
        `INSERT INTO field_visits (
           visit_type, visit_family, status,
           client_id, branch_id,
           source_legacy_type, source_legacy_id,
           closed_by, closed_at,
           created_at, updated_at
         ) VALUES (
           'emergency', 'service', 'ended',
           $1, $2,
           'open_task', $3::text,
           $4, NOW(),
           NOW(), NOW()
         )
         ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET
           status     = 'ended',
           closed_by  = EXCLUDED.closed_by,
           closed_at  = NOW(),
           updated_at = NOW()
         RETURNING id`,
        [taskRow.client_id, taskRow.branch_id, id, closedBy],
      );
      const fieldVisitId = fvRows[0].id;

      // 2. Upsert visit_task
      const { rows: vtRows } = await db.query(
        `INSERT INTO visit_tasks (
           field_visit_id, source_open_task_id,
           task_type, task_family, sequence_no,
           status, execution_notes,
           source_legacy_type, source_legacy_id,
           created_at, updated_at
         ) VALUES (
           $1, $2,
           'emergency_maintenance', 'service', 1,
           'completed', $3,
           'open_task', $4::text,
           NOW(), NOW()
         )
         ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET
           status          = 'completed',
           execution_notes = EXCLUDED.execution_notes,
           updated_at      = NOW()
         RETURNING id`,
        [fieldVisitId, id, closingNotes, id],
      );
      const visitTaskId = vtRows[0].id;

      // 3. Upsert visit_task_result (Phase 4 rule: this is the moment of finalization)
      const { rows: vtrRows } = await db.query(
        `INSERT INTO visit_task_results (
           visit_task_id, final_decision, reason_code, closing_notes,
           closed_by, closed_at, created_at, updated_at
         ) VALUES (
           $1, $2, NULL, $3,
           $4, NOW(), NOW(), NOW()
         )
         ON CONFLICT (visit_task_id) DO UPDATE SET
           final_decision = EXCLUDED.final_decision,
           closing_notes  = EXCLUDED.closing_notes,
           closed_by      = EXCLUDED.closed_by,
           closed_at      = NOW(),
           updated_at     = NOW()
         RETURNING id`,
        [visitTaskId, finalDecision, closingNotes, closedBy],
      );
      const visitTaskResultId = vtrRows[0].id;

      // 4. Technical state — linked to visit_task_result (not visit_task)
      if (technicalState && typeof technicalState === 'object') {
        await db.query(
          `INSERT INTO visit_task_emergency_technical_states (
             visit_task_result_id,
             problem_confirmed, technical_notes,
             water_tds_before, water_tds_after,
             pump_pressure, membrane_output, tank_pressure,
             low_pressure_switch, high_pressure_switch,
             solenoid_valve, uv_status,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
           ON CONFLICT (visit_task_result_id) DO UPDATE SET
             problem_confirmed    = EXCLUDED.problem_confirmed,
             technical_notes      = EXCLUDED.technical_notes,
             water_tds_before     = EXCLUDED.water_tds_before,
             water_tds_after      = EXCLUDED.water_tds_after,
             pump_pressure        = EXCLUDED.pump_pressure,
             membrane_output      = EXCLUDED.membrane_output,
             tank_pressure        = EXCLUDED.tank_pressure,
             low_pressure_switch  = EXCLUDED.low_pressure_switch,
             high_pressure_switch = EXCLUDED.high_pressure_switch,
             solenoid_valve       = EXCLUDED.solenoid_valve,
             uv_status            = EXCLUDED.uv_status,
             updated_at           = NOW()`,
          [
            visitTaskResultId,
            technicalState.problemConfirmed ?? null,
            technicalState.technicalNotes ?? null,
            technicalState.waterTdsBefore ?? null,
            technicalState.waterTdsAfter ?? null,
            technicalState.pumpPressure ?? null,
            technicalState.membraneOutput ?? null,
            technicalState.tankPressure ?? null,
            technicalState.lowPressureSwitch ?? null,
            technicalState.highPressureSwitch ?? null,
            technicalState.solenoidValve ?? null,
            technicalState.uvStatus ?? null,
          ],
        );
      }

      // 5. Parts used — linked to visit_task_result; replace entirely on each submission
      if (partsUsed.length > 0) {
        await db.query(
          'DELETE FROM visit_task_emergency_parts_used WHERE visit_task_result_id = $1',
          [visitTaskResultId],
        );
        for (const part of partsUsed) {
          if (!part.partNameSnapshot) continue;
          await db.query(
            `INSERT INTO visit_task_emergency_parts_used
               (visit_task_result_id, spare_part_id, part_name_snapshot, quantity, unit_price, created_at)
             VALUES ($1,$2,$3,$4,$5,NOW())`,
            [
              visitTaskResultId,
              part.sparePartId ?? null,
              String(part.partNameSnapshot),
              Number.isInteger(Number(part.quantity)) && Number(part.quantity) > 0 ? Number(part.quantity) : 1,
              part.unitPrice != null ? Number(part.unitPrice) : null,
            ],
          );
        }
      }

      // 6. Financials — linked to visit_task_result (not visit_task)
      if (financials && typeof financials === 'object') {
        await db.query(
          `INSERT INTO visit_task_emergency_financials (
             visit_task_result_id,
             labor_cost, parts_cost, total_cost,
             payment_method, collected_amount, invoice_notes,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
           ON CONFLICT (visit_task_result_id) DO UPDATE SET
             labor_cost       = EXCLUDED.labor_cost,
             parts_cost       = EXCLUDED.parts_cost,
             total_cost       = EXCLUDED.total_cost,
             payment_method   = EXCLUDED.payment_method,
             collected_amount = EXCLUDED.collected_amount,
             invoice_notes    = EXCLUDED.invoice_notes,
             updated_at       = NOW()`,
          [
            visitTaskResultId,
            financials.laborCost ?? null,
            financials.partsCost ?? null,
            financials.totalCost ?? null,
            financials.paymentMethod ?? null,
            financials.collectedAmount ?? null,
            financials.invoiceNotes ?? null,
          ],
        );
      }

      // 7. Phase 4 finalization rule: complete the field visit when all tasks resolved
      await maybeCompleteFieldVisit(db, fieldVisitId);

      // 8. Phase 4 finalization rule: update open_task status based on final decision
      const newOpenTaskStatus = mapDecisionToOpenTaskStatus(finalDecision);
      const { rows: preStatusRows } = await db.query(
        'SELECT status FROM open_tasks WHERE id = $1',
        [id],
      );
      const oldOpenTaskStatus = preStatusRows[0]?.status;
      const updateResult = await db.query(
        `UPDATE open_tasks
         SET status = $1, updated_at = NOW()
         WHERE id = $2
           AND status NOT IN ('completed', 'cancelled')`,
        [newOpenTaskStatus, id],
      );
      if ((updateResult as any).rowCount > 0 && oldOpenTaskStatus && oldOpenTaskStatus !== newOpenTaskStatus) {
        await db.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
           VALUES ($1, 'status_change', $2, NULL, $3, $4)`,
          [id, closedBy, oldOpenTaskStatus, newOpenTaskStatus],
        );
      }

      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }

    const task = await loadOpenTaskById(pool, id);
    res.json(task);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/emergency-result error:', err);
    res.status(500).json({ error: 'فشل في تسجيل نتيجة المهمة' });
  }
});

// GET /open-tasks/scope/:scopeId — list tasks linked to a work scope
router.get('/scope/:scopeId', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const scopeId = Number(req.params.scopeId);
    if (!Number.isFinite(scopeId)) {
      return res.status(400).json({ error: 'معرف النطاق غير صالح' });
    }

    const { rows } = await pool.query(
      `${OPEN_TASK_SELECT}
       JOIN scope_tasks st ON st.open_task_id = ot.id
       WHERE st.scope_id = $1
       ORDER BY ot.created_at DESC`,
      [scopeId],
    );

    res.json(rows.map(mapOpenTaskRow));
  } catch (err: any) {
    console.error('[open-tasks] GET /scope/:scopeId error:', err);
    res.status(500).json({ error: 'فشل في تحميل مهام النطاق' });
  }
});

// POST /open-tasks/:id/assign-scope — assign task to a work scope + team_key
router.post('/:id/assign-scope', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'معرف المهمة غير صالح' });
    }

    const scopeId = Number(req.body?.scopeId);
    const teamKey = String(req.body?.teamKey ?? '');
    if (!Number.isFinite(scopeId) || !teamKey) {
      return res.status(400).json({ error: 'scopeId و teamKey مطلوبان' });
    }

    const { rows: existing } = await pool.query(
      'SELECT branch_id FROM open_tasks WHERE id = $1',
      [id],
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }
    if (!authContext.isSuperAdmin && existing[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    await pool.query(
      `UPDATE open_tasks SET assigned_scope_id = $1, assigned_team_key = $2, updated_at = NOW()
       WHERE id = $3`,
      [scopeId, teamKey, id],
    );
    await pool.query(
      `INSERT INTO scope_tasks (scope_id, open_task_id, team_key, branch_id, added_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (scope_id, open_task_id) DO NOTHING`,
      [scopeId, id, teamKey, existing[0].branch_id, authContext.userId],
    );

    const task = await loadOpenTaskById(pool, id);
    res.json(task);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/assign-scope error:', err);
    res.status(500).json({ error: 'فشل في إسناد المهمة للنطاق' });
  }
});

// GET /open-tasks/:id/activity
router.get('/:id/activity', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query('SELECT branch_id FROM open_tasks WHERE id = $1', [id]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!authContext.isSuperAdmin && taskRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const { rows } = await pool.query(
      `SELECT
        tal.id,
        CASE WHEN tal.event_type = 'rescheduled' THEN 'needs_reschedule' ELSE tal.event_type END AS "eventType",
        tal.performed_by AS "performedBy",
        tal.role,
        tal.old_value AS "oldValue",
        tal.new_value AS "newValue",
        tal.reason,
        tal.reference_id AS "referenceId",
        tal.created_at AS "createdAt",
        hu.name AS "performedByName"
      FROM task_activity_log tal
      LEFT JOIN hr_users hu ON hu.id = tal.performed_by
      WHERE tal.task_id = $1
      ORDER BY tal.created_at DESC`,
      [id],
    );
    res.json(rows);
  } catch (err: any) {
    console.error('[open-tasks] GET /:id/activity error:', err);
    res.status(500).json({ error: 'فشل في تحميل سجل النشاط' });
  }
});

// POST /open-tasks/:id/activity
router.post('/:id/activity', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query('SELECT branch_id FROM open_tasks WHERE id = $1', [id]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!authContext.isSuperAdmin && taskRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const { eventType, oldValue, newValue, reason, referenceId } = req.body ?? {};
    const VALID_EVENT_TYPES = ['status_change', 'note_added', 'needs_reschedule', 'assigned', 'reassigned', 'call_made', 'priority_changed', 'team_assigned', 'offer_presented', 'customer_response'];
    if (!eventType || !VALID_EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({ error: 'نوع الحدث غير صالح' });
    }

    const normalizedEventType = eventType === 'rescheduled' ? 'needs_reschedule' : eventType;

    const performedBy = authContext.userId;
    const userRole = (req as any).user?.role ?? null;

    const { rows } = await pool.query(
      `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value, reason, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING
         id,
         event_type AS "eventType",
         performed_by AS "performedBy",
         role,
         old_value AS "oldValue",
         new_value AS "newValue",
         reason,
         reference_id AS "referenceId",
         created_at AS "createdAt"`,
      [id, normalizedEventType, performedBy, userRole, oldValue ?? null, newValue ?? null, reason ?? null, referenceId ?? null],
    );
    res.json(rows[0]);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/activity error:', err);
    res.status(500).json({ error: 'فشل في إضافة الحدث' });
  }
});

// GET /open-tasks/:id/devices
router.get('/:id/devices', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query('SELECT branch_id FROM open_tasks WHERE id = $1', [id]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!authContext.isSuperAdmin && taskRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const { rows } = await pool.query(
      `SELECT
        otd.id,
        otd.device_model_id AS "deviceModelId",
        otd.device_name_snapshot AS "deviceName",
        otd.quantity
      FROM open_task_devices otd
      WHERE otd.task_id = $1
      ORDER BY otd.created_at`,
      [id],
    );
    if (rows.length > 0) return res.json(rows);

    // Fallback 1: telemarketing_appointments with direct open_task_id link
    const { rows: taRows } = await pool.query(
      `SELECT
        ta.id,
        ta.requested_device_model_id AS "deviceModelId",
        ta.requested_device_name AS "deviceName",
        1 AS quantity
      FROM telemarketing_appointments ta
      WHERE ta.open_task_id = $1
        AND ta.requested_device_name IS NOT NULL
      ORDER BY ta.created_at`,
      [id],
    );
    if (taRows.length > 0) return res.json(taRows);

    // Fallback 2: marketing_visits device name via marketing_visit_tasks link
    const { rows: mvRows } = await pool.query(
      `SELECT
        mv.id,
        mv.requested_device_model_id AS "deviceModelId",
        mv.requested_device_name AS "deviceName",
        1 AS quantity
      FROM marketing_visits mv
      JOIN marketing_visit_tasks mvt ON mvt.visit_id = mv.id
      WHERE mvt.source_open_task_id = $1
        AND mv.requested_device_name IS NOT NULL
      ORDER BY mv.created_at
      LIMIT 1`,
      [id],
    );
    return res.json(mvRows);
  } catch (err: any) {
    console.error('[open-tasks] GET /:id/devices error:', err);
    res.status(500).json({ error: 'فشل في تحميل الأجهزة' });
  }
});

// POST /open-tasks/:id/devices
router.post('/:id/devices', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query('SELECT branch_id FROM open_tasks WHERE id = $1', [id]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!authContext.isSuperAdmin && taskRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const devices: any[] = Array.isArray(req.body?.devices) ? req.body.devices : [];
    if (devices.length === 0) return res.status(400).json({ error: 'لا توجد أجهزة للإضافة' });

    const inserted: any[] = [];
    for (const device of devices) {
      if (!device.deviceName) continue;
      const qty = Number.isInteger(Number(device.quantity)) && Number(device.quantity) > 0 ? Number(device.quantity) : 1;
      const { rows } = await pool.query(
        `INSERT INTO open_task_devices (task_id, device_model_id, device_name_snapshot, quantity)
         VALUES ($1, $2, $3, $4)
         RETURNING id, device_model_id AS "deviceModelId", device_name_snapshot AS "deviceName", quantity`,
        [id, device.deviceModelId ?? null, String(device.deviceName), qty],
      );
      if (rows[0]) inserted.push(rows[0]);
    }
    res.json(inserted);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/devices error:', err);
    res.status(500).json({ error: 'فشل في إضافة الأجهزة' });
  }
});

// GET /open-tasks/:id/calls
router.get('/:id/calls', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query('SELECT branch_id, client_id FROM open_tasks WHERE id = $1', [id]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!authContext.isSuperAdmin && taskRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const { rows } = await pool.query(
      `SELECT
        ccl.id,
        ccl.caller_id AS "userId",
        ccl.source_type AS "callType",
        ccl.outcome,
        ccl.notes,
        ccl.created_at AS "createdAt",
        hu.name AS "telemarketerName"
      FROM customer_call_logs ccl
      JOIN call_task_links ctl ON ctl.call_id = ccl.id
      LEFT JOIN hr_users hu ON hu.id = ccl.caller_id
      WHERE ctl.task_id = $1
      ORDER BY ccl.created_at DESC`,
      [id],
    );
    if (rows.length > 0) return res.json(rows);

    const { rows: legacyRows } = await pool.query(
      `SELECT
        ccl.id,
        ccl.caller_id AS "userId",
        ccl.source_type AS "callType",
        ccl.outcome,
        ccl.notes,
        ccl.created_at AS "createdAt",
        hu.name AS "telemarketerName"
      FROM telemarketing_task_list_items tli
      JOIN customer_call_logs ccl ON ccl.source_type = 'telemarketing_task' AND ccl.source_id = tli.id
      LEFT JOIN hr_users hu ON hu.id = ccl.caller_id
      WHERE tli.open_task_id = $1
      ORDER BY ccl.created_at DESC`,
      [id],
    );
    return res.json(legacyRows);
  } catch (err: any) {
    console.error('[open-tasks] GET /:id/calls error:', err);
    res.status(500).json({ error: 'فشل في تحميل المكالمات' });
  }
});

export default router;
