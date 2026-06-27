import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';
import { assertGeoUnitInScope } from '../services/geoScopeService.js';
import { assertDeviceModelInScope } from '../services/deviceScopeService.js';
import { createManualPeriodicMaintenanceTask } from '../services/periodicMaintenanceTasks.js';
import { TECH_STATE_FIELDS, mapTechState } from './emergencyResult.js';

const router = Router();
router.use(requireAuth);

const selectFields = `
  d.id,
  d.contract_id       AS "contractId",
  d.customer_id       AS "customerId",
  d.branch_id         AS "branchId",
  d.device_source     AS "deviceSource",
  d.external_device_name AS "externalDeviceName",
  d.external_device_serial AS "externalDeviceSerial",
  d.external_device_notes AS "externalDeviceNotes",
  COALESCE(d.device_model_id, c.device_model_id) AS "deviceModelId",
  COALESCE(d.device_model_name, c.device_model_name, d.external_device_name) AS "deviceModelName",
  dm.has_sterilization        AS "hasSterilization",
  d.serial_number     AS "serialNumber",
  d.status,
  d.installation_geo_unit_id  AS "installationGeoUnitId",
  d.installation_address_text AS "installationAddressText",
  d.installation_lat          AS "installationLat",
  d.installation_lng          AS "installationLng",
  d.delivery_date             AS "deliveryDate",
  d.installation_date         AS "installationDate",
  d.is_golden_warranty        AS "isGoldenWarranty",
  d.golden_warranty_end_date  AS "goldenWarrantyEndDate",
  d.contract_warranty_end_date AS "contractWarrantyEndDate",
  d.warranty_months           AS "warrantyMonths",
  d.warranty_visits           AS "warrantyVisits",
  d.activated_at              AS "activatedAt",
  d.created_at                AS "createdAt",
  d.updated_at                AS "updatedAt",
  c.contract_number           AS "contractNumber",
  c.sale_subtype              AS "saleSubtype",
  c.customer_name             AS "customerName",
  b.name                      AS "branchName",
  gu.name                     AS "installationGeoUnitName",
  jsonb_strip_nulls(jsonb_build_object(
    'serialNumber', CASE WHEN d.serial_number IS NULL OR btrim(d.serial_number) = '' THEN 'missing' END,
    'branchName', CASE WHEN b.name IS NULL THEN 'missing' END,
    'installationLocation', CASE
      WHEN d.installation_geo_unit_id IS NULL
       AND (d.installation_address_text IS NULL OR btrim(d.installation_address_text) = '')
       AND (d.installation_lat IS NULL OR d.installation_lng IS NULL)
      THEN 'missing'
    END,
    'deliveryDate', CASE WHEN d.delivery_date IS NULL THEN 'pending_or_missing' END,
    'installationDate', CASE WHEN d.installation_date IS NULL THEN 'pending_or_missing' END,
    'activatedAt', CASE WHEN d.activated_at IS NULL THEN 'pending_or_missing' END,
    'warrantyTerms', CASE WHEN d.warranty_months IS NULL AND d.warranty_visits IS NULL THEN 'missing' END
  )) AS "missingFields"
`;

// GET /api/installed-devices?customerId=X&branchId=Y
router.get('/', requirePermission('installed_devices.view', 'clients.devices.view', 'contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const { customerId, branchId, status } = req.query;
  const conditions: string[] = [];
  const params: any[] = [];

  if (customerId) { params.push(Number(customerId)); conditions.push(`d.customer_id = $${params.length}`); }
  if (branchId) {
    const requestedBranchId = Number(branchId);
    if (!Number.isInteger(requestedBranchId) || requestedBranchId <= 0) {
      return res.status(400).json({ error: 'معرف الفرع غير صالح' });
    }
    const access = {
      allowed:
        authorize(authContext, { permission: 'installed_devices.view', branchId: requestedBranchId }).allowed ||
        authorize(authContext, { permission: 'clients.devices.view', branchId: requestedBranchId }).allowed ||
        authorize(authContext, { permission: 'contracts.view_list', branchId: requestedBranchId }).allowed,
    };
    if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });
    params.push(requestedBranchId);
    conditions.push(`d.branch_id = $${params.length}`);
  } else if (!authContext.isSuperAdmin) {
    if (authContext.allowedBranchIds.length === 0) {
      return res.status(403).json({ error: 'لا يوجد فرع فعّال متاح لهذه العملية' });
    }
    params.push(authContext.allowedBranchIds);
    conditions.push(`d.branch_id = ANY($${params.length}::int[])`);
  }
  if (status)     { params.push(String(status));      conditions.push(`d.status = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT ${selectFields}
     FROM installed_devices d
     LEFT JOIN contracts c ON c.id = d.contract_id
     LEFT JOIN branches b ON b.id = d.branch_id
     LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
     LEFT JOIN device_models dm ON dm.id = COALESCE(d.device_model_id, c.device_model_id)
     ${where}
     ORDER BY d.created_at DESC`,
    params
  );
  res.json(rows);
});

// POST /api/installed-devices/external
router.post('/external', requirePermission('installed_devices.create_external'), async (req, res, next) => {
  try {
    const authContext = req.authContext!;
    const customerId = Number(req.body.customerId ?? req.body.customer_id);
    const deviceModelId = Number(req.body.deviceModelId ?? req.body.device_model_id);
    const serialNumber = String(req.body.serialNumber ?? req.body.externalDeviceSerial ?? '').trim();
    const externalDeviceNotes = String(req.body.externalDeviceNotes ?? '').trim() || null;
    const installationAddressText = String(req.body.installationAddressText ?? '').trim() || null;
    const installationGeoUnitId = Number(req.body.installationGeoUnitId ?? req.body.installation_geo_unit_id);
    const installationLatRaw = req.body.installationLat ?? req.body.installation_lat;
    const installationLngRaw = req.body.installationLng ?? req.body.installation_lng;
    const installationLat = installationLatRaw == null || installationLatRaw === '' ? null : Number(installationLatRaw);
    const installationLng = installationLngRaw == null || installationLngRaw === '' ? null : Number(installationLngRaw);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'Invalid customerId' });
    }
    if (!Number.isInteger(deviceModelId) || deviceModelId <= 0) {
      return res.status(400).json({ error: 'Device model is required' });
    }
    if (!serialNumber) {
      return res.status(400).json({ error: 'Serial number is required' });
    }
    if (!Number.isInteger(installationGeoUnitId) || installationGeoUnitId <= 0) {
      return res.status(400).json({ error: 'Installation neighborhood is required' });
    }
    if (!installationAddressText) {
      return res.status(400).json({ error: 'Installation address is required' });
    }
    if (
      (installationLat !== null && (!Number.isFinite(installationLat) || installationLat < -90 || installationLat > 90)) ||
      (installationLng !== null && (!Number.isFinite(installationLng) || installationLng < -180 || installationLng > 180)) ||
      ((installationLat === null) !== (installationLng === null))
    ) {
      return res.status(400).json({ error: 'Invalid GPS coordinates' });
    }

    const { rows: clientRows } = await pool.query(
      'SELECT id, branch_id AS "branchId" FROM clients WHERE id = $1',
      [customerId],
    );
    if (!clientRows[0]) return res.status(404).json({ error: 'Client not found' });
    const branchId = Number(clientRows[0].branchId);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return res.status(400).json({ error: 'Client registration branch is required' });
    }

    const createAccess = authorize(authContext, { permission: 'installed_devices.create_external', branchId });
    if (!createAccess.allowed) return res.status(403).json({ error: 'Forbidden' });

    const deviceCheck = await assertDeviceModelInScope(authContext, deviceModelId, branchId);
    if (!deviceCheck.allowed) {
      return res.status(403).json({
        error: 'Device model is outside the client branch scope',
        code: deviceCheck.reason,
      });
    }

    const { rows: branchDeviceRows } = await pool.query(
      `SELECT dm.id, COALESCE(dm.name_ar, dm.name) AS "deviceModelName"
         FROM device_models dm
        WHERE dm.id = $1
          AND dm.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
          FROM departments d
          WHERE d.branch_id = $2
            AND jsonb_array_length(COALESCE(d.device_model_ids, '[]'::jsonb)) > 0
            AND dm.id IN (SELECT (jsonb_array_elements_text(d.device_model_ids))::int)
        )`,
      [deviceModelId, branchId],
    );
    if (!branchDeviceRows[0]) {
      return res.status(400).json({ error: 'Device model is not available for the client branch' });
    }

    const geoCheck = await assertGeoUnitInScope(authContext, installationGeoUnitId, 'geo_units.lookup', branchId);
    if (!geoCheck.allowed) {
      return res.status(403).json({
        error: 'Installation address is outside the client branch coverage',
        code: geoCheck.reason,
      });
    }
    const { rows: geoRows } = await pool.query('SELECT level FROM geo_units WHERE id = $1', [installationGeoUnitId]);
    if (!geoRows[0] || Number(geoRows[0].level) !== 4) {
      return res.status(400).json({
        error: 'Installation address must be selected at neighborhood level',
        code: 'installation_geo_not_neighborhood',
      });
    }

    const deviceModelName = branchDeviceRows[0].deviceModelName;
    const { rows } = await pool.query(
      `INSERT INTO installed_devices (
         contract_id, customer_id, branch_id, device_source,
         device_model_id, device_model_name,
         external_device_name, external_device_serial, external_device_notes,
         serial_number, status,
         installation_geo_unit_id, installation_address_text, installation_lat, installation_lng,
         is_golden_warranty, warranty_months, warranty_visits
       ) VALUES (
         NULL, $1, $2, 'external',
         $3, $4,
         $4, $5, $6,
         $5, 'active',
         $7, $8, $9, $10,
         false, NULL, NULL
       )
       RETURNING id`,
      [
        customerId,
        branchId,
        deviceModelId,
        deviceModelName,
        serialNumber,
        externalDeviceNotes,
        installationGeoUnitId,
        installationAddressText,
        installationLat,
        installationLng,
      ],
    );

    res.status(201).json({ ok: true, id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

// GET /api/installed-devices/:id
router.get('/:id', requirePermission('installed_devices.view', 'clients.devices.view', 'contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows } = await pool.query(
    `SELECT ${selectFields}
     FROM installed_devices d
     LEFT JOIN contracts c ON c.id = d.contract_id
     LEFT JOIN branches b ON b.id = d.branch_id
     LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
     LEFT JOIN device_models dm ON dm.id = COALESCE(d.device_model_id, c.device_model_id)
     WHERE d.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
  const access = {
    allowed:
      authorize(authContext, { permission: 'installed_devices.view', branchId: rows[0].branchId }).allowed ||
      authorize(authContext, { permission: 'clients.devices.view', branchId: rows[0].branchId }).allowed ||
      authorize(authContext, { permission: 'contracts.view_list', branchId: rows[0].branchId }).allowed,
  };
  if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });
  res.json(rows[0]);
});

// POST /api/installed-devices/:id/periodic-maintenance
router.post('/:id/periodic-maintenance', requirePermission('tasks.periodic.create_manual'), async (req, res) => {
  const authContext = req.authContext!;
  const deviceId = Number(req.params.id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return res.status(400).json({ error: 'معرف الجهاز غير صالح' });
  }

  const { rows: devRows } = await pool.query(
    `SELECT branch_id AS "branchId"
       FROM installed_devices
      WHERE id = $1`,
    [deviceId],
  );
  if (!devRows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });

  const access = authorize(authContext, {
    permission: 'tasks.periodic.create_manual',
    branchId: devRows[0].branchId,
  });
  if (!access.allowed) return res.status(403).json({ error: 'غير مسموح بإنشاء دورية لهذا الفرع' });

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await createManualPeriodicMaintenanceTask(db, {
      installedDeviceId: deviceId,
      dueDate: String(req.body?.dueDate ?? req.body?.due_date ?? ''),
      manualReason: String(req.body?.manualReason ?? req.body?.manual_reason ?? ''),
      intervalMonths: req.body?.intervalMonths ?? req.body?.interval_months ?? null,
      notes: req.body?.notes ?? null,
      createdByUserId: authContext.userId ?? null,
    });
    await db.query('COMMIT');
    return res.status(201).json({ ok: true, ...result });
  } catch (err: any) {
    await db.query('ROLLBACK');
    return res.status(400).json({ error: err?.message ?? 'فشل إنشاء الصيانة الدورية' });
  } finally {
    db.release();
  }
});

// GET /api/installed-devices/:id/problems — full diagnosed-problems history
// for this device (across all service_requests / open_tasks). Read-only.
router.get('/:id/problems', requirePermission('clients.devices.view', 'contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const deviceId = Number(req.params.id);
  const { rows: devRows } = await pool.query(
    `SELECT branch_id AS "branchId" FROM installed_devices WHERE id = $1`,
    [deviceId],
  );
  if (!devRows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
  const access = {
    allowed:
      authorize(authContext, { permission: 'clients.devices.view', branchId: devRows[0].branchId }).allowed ||
      authorize(authContext, { permission: 'contracts.view_list', branchId: devRows[0].branchId }).allowed,
  };
  if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });

  const { rows } = await pool.query(
    `SELECT
       p.id,
       p.service_request_id          AS "serviceRequestId",
       sr.public_ref_number          AS "serviceRequestRef",
       p.open_task_id                AS "openTaskId",
       p.problem_type_id             AS "problemTypeId",
       sl.value                      AS "problemTypeLabel",
       p.details,
       p.status,
       p.added_during_phase          AS "addedDuringPhase",
       p.created_at                  AS "createdAt",
       p.created_by_user_id          AS "createdByUserId",
       creator.name                  AS "createdByName",
       p.resolved_at                 AS "resolvedAt",
       p.resolution_visit_task_id    AS "resolutionVisitTaskId",
       p.repaired_by_employee_id     AS "repairedByEmployeeId",
       repaired.name                 AS "repairedByEmployeeName",
       p.resolution_notes            AS "resolutionNotes"
       FROM service_request_problems p
       LEFT JOIN system_lists sl ON sl.id = p.problem_type_id
       LEFT JOIN service_requests sr ON sr.id = p.service_request_id
       LEFT JOIN hr_users creator ON creator.id = p.created_by_user_id
       LEFT JOIN employees repaired ON repaired.id = p.repaired_by_employee_id
       WHERE p.installed_device_id = $1
         AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC`,
    [deviceId],
  );
  res.json(rows);
});

// GET /api/installed-devices/:id/technical-states — device-keyed health record
// (constitution 01i). Read-only history, newest first. Branch-scoped via the
// device's own branch, guarded by installed_devices.view.
router.get('/:id/technical-states', requirePermission('installed_devices.view', 'clients.devices.view', 'contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const deviceId = Number(req.params.id);
  const { rows: devRows } = await pool.query(
    `SELECT branch_id AS "branchId" FROM installed_devices WHERE id = $1`,
    [deviceId],
  );
  if (!devRows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
  const access = {
    allowed:
      authorize(authContext, { permission: 'installed_devices.view', branchId: devRows[0].branchId }).allowed ||
      authorize(authContext, { permission: 'clients.devices.view', branchId: devRows[0].branchId }).allowed ||
      authorize(authContext, { permission: 'contracts.view_list', branchId: devRows[0].branchId }).allowed,
  };
  if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });

  const { rows } = await pool.query(
    `SELECT t.*,
            u.name AS "recordedByName",
            ot.task_type AS "taskType",
            ot.status    AS "taskStatus"
       FROM (
         SELECT ${TECH_STATE_FIELDS}
           FROM device_technical_states
          WHERE installed_device_id = $1
       ) t
       LEFT JOIN hr_users u ON u.id = t."recordedBy"
       LEFT JOIN open_tasks ot ON ot.id = t."openTaskId"
      ORDER BY t."createdAt" DESC`,
    [deviceId],
  );
  res.json(rows.map(mapTechState));
});

// PATCH /api/installed-devices/:id  — update physical device fields only
router.patch('/:id', requirePermission('contracts.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows: existingRows } = await pool.query(
    'SELECT branch_id AS "branchId" FROM installed_devices WHERE id = $1',
    [req.params.id],
  );
  if (!existingRows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
  const currentAccess = authorize(authContext, { permission: 'contracts.edit', branchId: existingRows[0].branchId });
  if (!currentAccess.allowed) return res.status(403).json({ error: 'غير مسموح' });

  const requestedTargetBranchId = req.body.branchId ?? req.body.branch_id;
  if (requestedTargetBranchId !== undefined && requestedTargetBranchId !== null && requestedTargetBranchId !== '') {
    const targetBranchId = Number(requestedTargetBranchId);
    if (!Number.isInteger(targetBranchId) || targetBranchId <= 0) {
      return res.status(400).json({ error: 'معرف الفرع المستهدف غير صالح' });
    }
    const targetAccess = authorize(authContext, { permission: 'contracts.edit', branchId: targetBranchId });
    if (!targetAccess.allowed) return res.status(403).json({ error: 'لا يمكنك نقل الجهاز إلى فرع غير مسموح به' });
    const { rows: branchRows } = await pool.query('SELECT status FROM branches WHERE id = $1', [targetBranchId]);
    if (!branchRows[0]) return res.status(400).json({ error: 'الفرع المستهدف غير موجود' });
    if (branchRows[0].status === 'inactive') return res.status(400).json({ error: 'لا يمكن نقل الجهاز إلى فرع موقوف' });
  }

  // Geo-coverage enforcement — if the patch moves installation_geo_unit_id,
  // it must land inside the (possibly new) target branch's coverage.
  const newGeoUnitId = req.body.installationGeoUnitId ?? req.body.installation_geo_unit_id ?? null;
  if (newGeoUnitId) {
    const effectiveBranchId = requestedTargetBranchId !== undefined && requestedTargetBranchId !== null && requestedTargetBranchId !== ''
      ? Number(requestedTargetBranchId)
      : existingRows[0].branchId;
    const geoCheck = await assertGeoUnitInScope(authContext, newGeoUnitId, 'geo_units.lookup', effectiveBranchId);
    if (!geoCheck.allowed) {
      return res.status(403).json({
        error: 'موقع تَركيب الجهاز خارج نِطاق تَغطية الفَرع',
        code: geoCheck.reason,
      });
    }
  }

  const allowed = [
    'branch_id', 'serial_number', 'status',
    'installation_geo_unit_id', 'installation_address_text', 'installation_lat', 'installation_lng',
    'delivery_date', 'installation_date',
    'is_golden_warranty', 'golden_warranty_end_date',
    'contract_warranty_end_date', 'warranty_months', 'warranty_visits',
  ];
  const sets: string[] = [];
  const params: any[] = [];

  const fieldMap: Record<string, string> = {
    branchId: 'branch_id',
    branch_id: 'branch_id',
    serialNumber: 'serial_number',
    status: 'status',
    installationGeoUnitId: 'installation_geo_unit_id',
    installationAddressText: 'installation_address_text',
    installationLat: 'installation_lat',
    installationLng: 'installation_lng',
    deliveryDate: 'delivery_date',
    installationDate: 'installation_date',
    isGoldenWarranty: 'is_golden_warranty',
    goldenWarrantyEndDate: 'golden_warranty_end_date',
    contractWarrantyEndDate: 'contract_warranty_end_date',
    warrantyMonths: 'warranty_months',
    warrantyVisits: 'warranty_visits',
  };

  for (const [camel, col] of Object.entries(fieldMap)) {
    if (req.body[camel] !== undefined) {
      params.push(req.body[camel]);
      sets.push(`${col} = $${params.length}`);
    }
  }

  if (sets.length === 0) return res.status(400).json({ error: 'لا يوجد حقول للتحديث' });

  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE installed_devices SET ${sets.join(', ')}
     WHERE id = $${params.length}
     RETURNING id`,
    params
  );
  if (!rows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
  res.json({ ok: true, id: rows[0].id });
});

export default router;
