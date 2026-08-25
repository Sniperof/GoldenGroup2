import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';
import { assertGeoUnitInScope } from '../services/geoScopeService.js';
import { assertDeviceModelInScope } from '../services/deviceScopeService.js';
import { createManualPeriodicMaintenanceTask } from '../services/periodicMaintenanceTasks.js';
import {
  assertDeviceSerialAvailable,
  deviceSerialConflictPayload,
  normalizeDeviceSerialNumber,
} from '../services/deviceSerialIntegrity.js';
import { TECH_STATE_FIELDS, mapTechState } from './emergencyResult.js';
import {
  changeDeviceDeliverySuspension,
  DeviceDeliverySuspensionError,
} from '../services/deviceDeliverySuspension.js';

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
  dm.is_golden_warranty      AS "modelSupportsGoldenWarranty",
  dm.golden_warranty_periods AS "goldenWarrantyPeriods",
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
  active_sa.id                AS "activeServiceAgreementId",
  active_sa.maintenance_plan  AS "activeServiceAgreementMaintenancePlan",
  active_sa.visits_count      AS "activeServiceAgreementVisitsCount",
  d.activated_at              AS "activatedAt",
  d.created_at                AS "createdAt",
  d.updated_at                AS "updatedAt",
  c.contract_number           AS "contractNumber",
  c.sale_subtype              AS "saleSubtype",
  COALESCE(cl.name, c.customer_name) AS "customerName",
  b.name                      AS "branchName",
  gu.name                     AS "installationGeoUnitName",
  jsonb_strip_nulls(jsonb_build_object(
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
     LEFT JOIN clients cl ON cl.id = d.customer_id
     LEFT JOIN branches b ON b.id = d.branch_id
     LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
     LEFT JOIN device_models dm ON dm.id = COALESCE(d.device_model_id, c.device_model_id)
     LEFT JOIN LATERAL (
       SELECT sa.id, sa.maintenance_plan, sa.visits_count
         FROM service_agreements sa
        WHERE sa.installed_device_id = d.id
          AND sa.status = 'active'
          AND (sa.start_date IS NULL OR sa.start_date <= CURRENT_DATE)
          AND (sa.end_date IS NULL OR sa.end_date >= CURRENT_DATE)
        ORDER BY COALESCE(sa.start_date, sa.agreement_date) DESC, sa.id DESC
        LIMIT 1
     ) active_sa ON TRUE
     ${where}
     ORDER BY d.created_at DESC`,
    params
  );
  res.json(rows);
});

// Shared branch-scope for the device list endpoints. Installed devices are
// branch-only (no ASSIGNED tier): scope is the branch filter alone. Mirrors the
// Contracts records pattern (actingBranchId for non-super-admin; optional
// X-Branch-Id narrowing for a GLOBAL super-admin) so GET '/' and '/paged' agree.
function appendInstalledDeviceListScope(authContext: any, req: any, params: any[]): string[] {
  const conditions: string[] = [];
  if (!authContext.isSuperAdmin) {
    conditions.push(`d.branch_id = $${params.push(authContext.actingBranchId)}`);
  } else {
    const hb = Number(req.header('x-branch-id'));
    if (Number.isFinite(hb) && hb > 0) conditions.push(`d.branch_id = $${params.push(hb)}`);
  }
  return conditions;
}

// Whitelist of sortable columns for GET '/paged' (never interpolate raw input).
const INSTALLED_DEVICE_SORT_COLUMNS: Record<string, string> = {
  id: 'd.id',
  deviceModelName: 'COALESCE(d.device_model_name, c.device_model_name, d.external_device_name)',
  customerName: 'COALESCE(cl.name, c.customer_name)',
  installationDate: 'd.installation_date',
  status: 'd.status',
  createdAt: 'd.created_at',
};

// GET /api/installed-devices/paged — server pagination + rich filters + sort.
// Isolated companion to GET '/'; the records page (InstalledDevicesList) is its
// only consumer. Branch-scoped via appendInstalledDeviceListScope (no drift).
router.get('/paged', requirePermission('installed_devices.view', 'clients.devices.view', 'contracts.view_list'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const params: any[] = [];
    const conditions = appendInstalledDeviceListScope(authContext, req, params);

    const cid = Number(req.query.customerId);
    if (cid > 0) conditions.push(`d.customer_id = $${params.push(cid)}`);

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      params.push(`%${search}%`);
      const ref = `$${params.length}`;
      conditions.push(
        `(COALESCE(d.device_model_name, c.device_model_name, d.external_device_name) ILIKE ${ref}`
        + ` OR d.serial_number ILIKE ${ref}`
        + ` OR COALESCE(cl.name, c.customer_name) ILIKE ${ref}`
        + ` OR c.contract_number ILIKE ${ref})`,
      );
    }

    const DEVICE_STATUSES = ['registered', 'pending_delivery', 'delivery_suspended', 'delivered', 'installed', 'active', 'faulty', 'in_workshop', 'ready', 'out_of_service', 'retrieved', 'contract_cancelled'];
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    if (DEVICE_STATUSES.includes(status)) { params.push(status); conditions.push(`d.status = $${params.length}`); }

    const deviceSource = typeof req.query.deviceSource === 'string' ? req.query.deviceSource.trim() : '';
    if (['company_contract', 'external'].includes(deviceSource)) { params.push(deviceSource); conditions.push(`d.device_source = $${params.length}`); }

    const goldenWarranty = req.query.goldenWarranty;
    if (goldenWarranty === 'true' || goldenWarranty === 'yes') conditions.push(`d.is_golden_warranty = TRUE`);
    else if (goldenWarranty === 'false' || goldenWarranty === 'no') conditions.push(`d.is_golden_warranty IS NOT TRUE`);

    const saleSubtype = typeof req.query.saleSubtype === 'string' ? req.query.saleSubtype.trim() : '';
    if (['definitive', 'temporary', 'free'].includes(saleSubtype)) { params.push(saleSubtype); conditions.push(`c.sale_subtype = $${params.length}`); }

    const toId = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
    const deviceModel = toId(req.query.deviceModel);
    if (deviceModel != null) { params.push(deviceModel); conditions.push(`COALESCE(d.device_model_id, c.device_model_id) = $${params.length}`); }

    // Geo subtree: the frontend expands a selected node to its descendant ids.
    const geoIds = typeof req.query.geoIds === 'string'
      ? req.query.geoIds.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s))
      : [];
    if (geoIds.length > 0) { params.push(geoIds.map(Number)); conditions.push(`d.installation_geo_unit_id = ANY($${params.length}::int[])`); }

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const installFrom = typeof req.query.installFrom === 'string' && dateRe.test(req.query.installFrom) ? req.query.installFrom : '';
    if (installFrom) { params.push(installFrom); conditions.push(`d.installation_date >= $${params.length}::date`); }
    const installTo = typeof req.query.installTo === 'string' && dateRe.test(req.query.installTo) ? req.query.installTo : '';
    if (installTo) { params.push(installTo); conditions.push(`d.installation_date < ($${params.length}::date + INTERVAL '1 day')`); }

    const hasServiceAgreement = req.query.hasServiceAgreement;
    if (hasServiceAgreement === 'yes') conditions.push(`active_sa.id IS NOT NULL`);
    else if (hasServiceAgreement === 'no') conditions.push(`active_sa.id IS NULL`);

    // Warranty ending within N days (golden or contract) — renewal targeting.
    const expDays = Number(req.query.warrantyExpiringDays);
    if (Number.isInteger(expDays) && expDays > 0) {
      params.push(expDays);
      const ref = `$${params.length}`;
      conditions.push(
        `(GREATEST(COALESCE(d.golden_warranty_end_date, DATE '1900-01-01'), COALESCE(d.contract_warranty_end_date, DATE '1900-01-01')) >= CURRENT_DATE`
        + ` AND LEAST(COALESCE(d.golden_warranty_end_date, DATE '9999-12-31'), COALESCE(d.contract_warranty_end_date, DATE '9999-12-31')) <= CURRENT_DATE + (${ref} || ' days')::interval)`,
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const pageRaw = Number(req.query.page);
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limitRaw = Number(req.query.limit);
    const limit = Math.min(100, Math.max(1, Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 25));
    const offset = (page - 1) * limit;

    const sortKey = typeof req.query.sortKey === 'string' && INSTALLED_DEVICE_SORT_COLUMNS[req.query.sortKey]
      ? req.query.sortKey
      : 'createdAt';
    const sortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';
    const orderBy = `${INSTALLED_DEVICE_SORT_COLUMNS[sortKey]} ${sortDir}, d.id ${sortDir}`;

    const fromJoins =
      `FROM installed_devices d
       LEFT JOIN contracts c ON c.id = d.contract_id
       LEFT JOIN clients cl ON cl.id = d.customer_id
       LEFT JOIN branches b ON b.id = d.branch_id
       LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
       LEFT JOIN device_models dm ON dm.id = COALESCE(d.device_model_id, c.device_model_id)
       LEFT JOIN LATERAL (
         SELECT sa.id, sa.maintenance_plan, sa.visits_count
           FROM service_agreements sa
          WHERE sa.installed_device_id = d.id
            AND sa.status = 'active'
            AND (sa.start_date IS NULL OR sa.start_date <= CURRENT_DATE)
            AND (sa.end_date IS NULL OR sa.end_date >= CURRENT_DATE)
          ORDER BY COALESCE(sa.start_date, sa.agreement_date) DESC, sa.id DESC
          LIMIT 1
       ) active_sa ON TRUE`;

    const pageParams = [...params, limit, offset];
    const limitRef = `$${params.length + 1}`;
    const offsetRef = `$${params.length + 2}`;

    const [pageResult, countResult] = await Promise.all([
      pool.query(`SELECT ${selectFields} ${fromJoins} ${where} ORDER BY ${orderBy} LIMIT ${limitRef} OFFSET ${offsetRef}`, pageParams),
      pool.query(`SELECT COUNT(*)::int AS total ${fromJoins} ${where}`, params),
    ]);

    res.json({ items: pageResult.rows, total: countResult.rows[0]?.total ?? 0, page, limit });
  } catch (err: any) {
    console.error('[installed-devices] paged failed:', err);
    res.status(500).json({ error: 'فشل تحميل الأجهزة', detail: err?.message });
  }
});

// POST /api/installed-devices/external
router.post('/external', requirePermission('installed_devices.create_external'), async (req, res, next) => {
  try {
    const authContext = req.authContext!;
    const customerId = Number(req.body.customerId ?? req.body.customer_id);
    const deviceModelId = Number(req.body.deviceModelId ?? req.body.device_model_id);
    const serialNumber = normalizeDeviceSerialNumber(
      req.body.serialNumber ?? req.body.externalDeviceSerial,
    );
    const requestedStatus = String(req.body.status ?? req.body.deviceStatus ?? '').trim();
    const externalDeviceNotes = String(req.body.externalDeviceNotes ?? '').trim() || null;
    const installationAddressText = String(req.body.installationAddressText ?? '').trim() || null;
    const installationGeoUnitId = Number(req.body.installationGeoUnitId ?? req.body.installation_geo_unit_id);
    const installationLatRaw = req.body.installationLat ?? req.body.installation_lat;
    const installationLngRaw = req.body.installationLng ?? req.body.installation_lng;
    const installationLat = installationLatRaw == null || installationLatRaw === '' ? null : Number(installationLatRaw);
    const installationLng = installationLngRaw == null || installationLngRaw === '' ? null : Number(installationLngRaw);
    const serviceAgreement = req.body.serviceAgreement ?? req.body.service_agreement ?? null;
    const wantsServiceAgreement = Boolean(serviceAgreement && typeof serviceAgreement === 'object');

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'Invalid customerId' });
    }
    if (!Number.isInteger(deviceModelId) || deviceModelId <= 0) {
      return res.status(400).json({ error: 'Device model is required' });
    }
    const allowedExternalStatuses = new Set(['delivered', 'installed', 'active', 'faulty']);
    if (!allowedExternalStatuses.has(requestedStatus)) {
      return res.status(400).json({ error: 'Device status is required and must be delivered, installed, active, or faulty' });
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
      'SELECT id, name, branch_id AS "branchId" FROM clients WHERE id = $1',
      [customerId],
    );
    if (!clientRows[0]) return res.status(404).json({ error: 'Client not found' });
    const branchId = Number(clientRows[0].branchId);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return res.status(400).json({ error: 'Client registration branch is required' });
    }

    const createAccess = authorize(authContext, { permission: 'installed_devices.create_external', branchId });
    if (!createAccess.allowed) return res.status(403).json({ error: 'Forbidden' });
    if (wantsServiceAgreement) {
      const agreementAccess = authorize(authContext, { permission: 'contracts.edit', branchId });
      if (!agreementAccess.allowed) {
        return res.status(403).json({ error: 'إنشاء اتفاق الخدمة يحتاج صلاحية تعديل العقود ضمن فرع الزبون' });
      }
    }
    const agreementDate = wantsServiceAgreement
      ? String(serviceAgreement.agreementDate ?? serviceAgreement.agreement_date ?? '').trim() || new Date().toISOString().slice(0, 10)
      : null;
    const visitsCountRaw = wantsServiceAgreement ? (serviceAgreement.visitsCount ?? serviceAgreement.visits_count) : null;
    const visitsCount = visitsCountRaw == null || visitsCountRaw === '' ? null : Number(visitsCountRaw);
    const feeRaw = wantsServiceAgreement ? (serviceAgreement.feeSyp ?? serviceAgreement.fee_syp) : null;
    const feeSyp = feeRaw == null || feeRaw === '' ? 0 : Number(feeRaw);
    if (wantsServiceAgreement && visitsCount != null && (!Number.isFinite(visitsCount) || visitsCount <= 0)) {
      return res.status(400).json({ error: 'عدد زيارات اتفاق الخدمة غير صالح' });
    }
    if (wantsServiceAgreement && (!Number.isFinite(feeSyp) || feeSyp < 0)) {
      return res.status(400).json({ error: 'بدل اتفاق الخدمة غير صالح' });
    }

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
    const db = await pool.connect();
    try {
      await db.query('BEGIN');

      await assertDeviceSerialAvailable(db, serialNumber);

      const { rows } = await db.query(
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
           $5, $7,
           $8, $9, $10, $11,
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
          requestedStatus,
          installationGeoUnitId,
          installationAddressText,
          installationLat,
          installationLng,
        ],
      );

      const deviceId = Number(rows[0].id);
      const { rows: actorRows } = await db.query(
        'SELECT employee_id AS "employeeId" FROM hr_users WHERE id = $1',
        [authContext.userId],
      );
      const createdByEmployeeId = Number(actorRows[0]?.employeeId);
      await db.query(
        `INSERT INTO device_possession_log
           (device_id, holder_type, holder_id, start_at, reason, notes, created_by)
         VALUES ($1, 'customer', $2, NOW(), 'external_registration', $3, $4)`,
        [
          deviceId,
          customerId,
          externalDeviceNotes ?? 'External device registered under customer possession',
          Number.isInteger(createdByEmployeeId) && createdByEmployeeId > 0 ? createdByEmployeeId : null,
        ],
      );

      if (wantsServiceAgreement) {
        await db.query(
          `INSERT INTO service_agreements (
             agreement_number, customer_id, customer_name, branch_id, installed_device_id, agreement_date,
             external_device_model_name, external_device_serial, external_device_notes,
             maintenance_plan, visits_count, fee_syp,
             status, start_date, end_date,
             created_by, notes
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13,$14,$15,$16)`,
          [
            serviceAgreement.agreementNumber ?? serviceAgreement.agreement_number ?? null,
            customerId,
            clientRows[0].name,
            branchId,
            deviceId,
            agreementDate,
            deviceModelName,
            serialNumber,
            externalDeviceNotes,
            serviceAgreement.maintenancePlan ?? serviceAgreement.maintenance_plan ?? null,
            visitsCount,
            feeSyp,
            serviceAgreement.startDate ?? serviceAgreement.start_date ?? null,
            serviceAgreement.endDate ?? serviceAgreement.end_date ?? null,
            authContext.userId ?? null,
            serviceAgreement.notes ?? null,
          ],
        );
      }

      await db.query('COMMIT');
      res.status(201).json({ ok: true, id: deviceId });
    } catch (err) {
      try {
        await db.query('ROLLBACK');
      } catch {
        // Keep the original database error visible to the API error handler.
      }
      throw err;
    } finally {
      db.release();
    }
  } catch (err) {
    const conflict = deviceSerialConflictPayload(err);
    if (conflict) return res.status(409).json(conflict);
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
     LEFT JOIN clients cl ON cl.id = d.customer_id
     LEFT JOIN branches b ON b.id = d.branch_id
     LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
     LEFT JOIN device_models dm ON dm.id = COALESCE(d.device_model_id, c.device_model_id)
     LEFT JOIN LATERAL (
       SELECT sa.id, sa.maintenance_plan, sa.visits_count
         FROM service_agreements sa
        WHERE sa.installed_device_id = d.id
          AND sa.status = 'active'
          AND (sa.start_date IS NULL OR sa.start_date <= CURRENT_DATE)
          AND (sa.end_date IS NULL OR sa.end_date >= CURRENT_DATE)
        ORDER BY COALESCE(sa.start_date, sa.agreement_date) DESC, sa.id DESC
        LIMIT 1
     ) active_sa ON TRUE
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

// GET /api/installed-devices/:id/delivery-suspension-history
router.get(
  '/:id/delivery-suspension-history',
  requirePermission('installed_devices.view', 'clients.devices.view', 'contracts.view_list'),
  async (req, res) => {
    const deviceId = Number(req.params.id);
    if (!Number.isInteger(deviceId) || deviceId <= 0) {
      return res.status(400).json({ error: 'معرف الجهاز غير صالح' });
    }
    const { rows: deviceRows } = await pool.query(
      'SELECT branch_id AS "branchId" FROM installed_devices WHERE id = $1',
      [deviceId],
    );
    if (!deviceRows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
    const authContext = req.authContext!;
    const access = {
      allowed:
        authorize(authContext, { permission: 'installed_devices.view', branchId: deviceRows[0].branchId }).allowed ||
        authorize(authContext, { permission: 'clients.devices.view', branchId: deviceRows[0].branchId }).allowed ||
        authorize(authContext, { permission: 'contracts.view_list', branchId: deviceRows[0].branchId }).allowed,
    };
    if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });
    const { rows } = await pool.query(
      `SELECT al.id,
              al.action_type AS "actionType",
              al.old_value AS "oldStatus",
              al.new_value AS "newStatus",
              al.internal_reason AS details,
              al.performed_by_user_id AS "performedByUserId",
              COALESCE(e.name, u.username) AS "performedByName",
              al."timestamp" AS "createdAt"
         FROM audit_logs al
         LEFT JOIN hr_users u ON u.id = al.performed_by_user_id
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE al.entity_type = 'InstalledDevice'
          AND al.entity_id = $1
          AND al.action_type IN ('delivery_suspended', 'delivery_resumed')
        ORDER BY al."timestamp" DESC, al.id DESC`,
      [deviceId],
    );
    return res.json(rows);
  },
);

async function executeDeliverySuspensionChange(req: any, res: any, action: 'suspend' | 'resume') {
  const deviceId = Number(req.params.id);
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return res.status(400).json({ error: 'معرف الجهاز غير صالح' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await changeDeviceDeliverySuspension(client, {
      deviceId,
      action,
      notes,
      authContext: req.authContext!,
      actorRole: req.user?.role ?? null,
    });
    await client.query('COMMIT');
    return res.json({ ok: true, ...result });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof DeviceDeliverySuspensionError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    throw error;
  } finally {
    client.release();
  }
}

router.post(
  '/:id/suspend-delivery',
  requirePermission('installed_devices.delivery_suspension.manage'),
  async (req, res, next) => {
    try {
      return await executeDeliverySuspensionChange(req, res, 'suspend');
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/:id/resume-delivery',
  requirePermission('installed_devices.delivery_suspension.manage'),
  async (req, res, next) => {
    try {
      return await executeDeliverySuspensionChange(req, res, 'resume');
    } catch (error) {
      return next(error);
    }
  },
);

// PATCH /api/installed-devices/:id  — update physical device fields only
router.patch('/:id', requirePermission('contracts.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows: existingRows } = await pool.query(
    'SELECT branch_id AS "branchId", status FROM installed_devices WHERE id = $1',
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
      let value = req.body[camel];
      if (col === 'status' && (String(value) === 'delivery_suspended' || existingRows[0].status === 'delivery_suspended')) {
        return res.status(409).json({
          error: 'تعليق التسليم وإعادته متاحان فقط من الإجراء المخصص في تفاصيل الجهاز',
          code: 'delivery_suspension_workflow_required',
        });
      }
      if (col === 'serial_number') {
        try {
          value = await assertDeviceSerialAvailable(
            pool,
            value,
            { deviceId: Number(req.params.id) },
          );
        } catch (err) {
          const conflict = deviceSerialConflictPayload(err);
          if (conflict) return res.status(409).json(conflict);
          throw err;
        }
      }
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    }
  }

  if (sets.length === 0) return res.status(400).json({ error: 'لا يوجد حقول للتحديث' });

  params.push(req.params.id);
  let rows: Array<{ id: number }>;
  try {
    ({ rows } = await pool.query(
      `UPDATE installed_devices SET ${sets.join(', ')}
       WHERE id = $${params.length}
       RETURNING id`,
      params,
    ));
  } catch (err) {
    const conflict = deviceSerialConflictPayload(err);
    if (conflict) return res.status(409).json(conflict);
    throw err;
  }
  if (!rows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
  res.json({ ok: true, id: rows[0].id });
});

export default router;
