import { Router } from 'express';
import { requireAppAuth } from '../middleware/appAuth.js';
import pool from '../db.js';
import { sendAppError } from '../utils/appErrors.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: App - Devices
 *     description: Customer mobile-app "My Devices" read-only view. DEC-017.
 */

/**
 * @swagger
 * /api/app/me/devices:
 *   get:
 *     tags: [App - Devices]
 *     summary: List every device owned by the authenticated customer
 *     description: >
 *       Unlike the request-intake device pickers (emergency/periodic-maintenance,
 *       golden-warranty), this is a full record — every device regardless of
 *       status, with its most relevant warranty row (DEC-017 D-AV6).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Device list for the authenticated customer }
 *       401: { description: Missing or invalid app bearer token }
 */
router.get('/me/devices', requireAppAuth, async (req, res) => {
  try {
    const clientId = req.appAccount!.clientId;
    const { rows } = await pool.query(
      `SELECT d.id,
              d.device_model_id AS "deviceModelId",
              COALESCE(NULLIF(d.device_model_name, ''), dm.name_ar, dm.name_en, dm.name, d.external_device_name) AS "deviceName",
              d.serial_number AS "serialNumber",
              d.status,
              d.contract_id AS "contractId",
              c.contract_number AS "contractNumber",
              d.installation_address_text AS "installationAddressText",
              d.installation_geo_unit_id AS "installationGeoUnitId",
              gu.name AS "installationGeoUnitName",
              d.delivery_date AS "deliveryDate",
              d.installation_date AS "installationDate",
              d.activated_at AS "activatedAt",
              d.is_golden_warranty AS "isGoldenWarranty",
              w.warranty_type AS "warrantyType",
              w.status AS "warrantyStatus",
              w.start_date AS "warrantyStartDate",
              w.months AS "warrantyMonths",
              w.visits AS "warrantyVisits",
              w.end_date AS "warrantyEndDate"
         FROM installed_devices d
         LEFT JOIN contracts c ON c.id = d.contract_id
         LEFT JOIN device_models dm ON dm.id = d.device_model_id
         LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
         LEFT JOIN LATERAL (
           SELECT warranty_type, status, start_date, months, visits, end_date
             FROM device_warranties
            WHERE device_id = d.id
            ORDER BY (status = 'active') DESC, created_at DESC
            LIMIT 1
         ) w ON TRUE
        WHERE d.customer_id = $1
        ORDER BY d.created_at DESC, d.id DESC`,
      [clientId],
    );
    return res.json({ items: rows });
  } catch (err) {
    return sendAppError(res, err, 'devices.mine');
  }
});

/**
 * @swagger
 * /api/app/me/devices/{deviceId}:
 *   get:
 *     tags: [App - Devices]
 *     summary: Get one installed device owned by the authenticated customer
 *     description: >
 *       Returns the customer-facing detail snapshot for one installed device.
 *       The ownership predicate is part of the database query so a foreign
 *       device id is indistinguishable from a missing device (404).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Device detail }
 *       400: { description: Invalid device id }
 *       401: { description: Missing or invalid app bearer token }
 *       404: { description: Device missing or not owned by this customer }
 */
router.get('/me/devices/:deviceId', requireAppAuth, async (req, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return res.status(400).json({ error: 'معرف الجهاز غير صالح' });
  }

  try {
    const clientId = req.appAccount!.clientId;
    const { rows } = await pool.query(
      `SELECT d.id,
              d.device_model_id AS "deviceModelId",
              COALESCE(NULLIF(d.device_model_name, ''), dm.name_ar, dm.name_en, dm.name, d.external_device_name) AS "deviceName",
              d.serial_number AS "serialNumber",
              d.status,
              d.contract_id AS "contractId",
              c.contract_number AS "contractNumber",
              b.name AS "serviceBranchName",
              d.installation_geo_unit_id AS "installationGeoUnitId",
              gu.name AS "installationGeoUnitName",
              d.installation_address_text AS "installationAddressText",
              d.installation_lat AS "installationLat",
              d.installation_lng AS "installationLng",
              d.delivery_date AS "deliveryDate",
              d.installation_date AS "installationDate",
              d.activated_at AS "activatedAt",
              d.is_golden_warranty AS "isGoldenWarranty",
              w.warranty_type AS "warrantyType",
              w.status AS "warrantyStatus",
              w.start_date AS "warrantyStartDate",
              w.months AS "warrantyMonths",
              w.visits AS "warrantyVisits",
              w.end_date AS "warrantyEndDate",
              COALESCE(active_work.active_task_count, 0)::int AS "activeTaskCount",
              CASE WHEN active_sa.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', active_sa.id,
                'agreementNumber', active_sa.agreement_number,
                'maintenancePlan', active_sa.maintenance_plan,
                'visitsCount', active_sa.visits_count,
                'startDate', active_sa.start_date,
                'endDate', active_sa.end_date
              ) END AS "activeServiceAgreement"
         FROM installed_devices d
         LEFT JOIN contracts c ON c.id = d.contract_id
         LEFT JOIN branches b ON b.id = d.branch_id
         LEFT JOIN device_models dm ON dm.id = d.device_model_id
         LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
         LEFT JOIN LATERAL (
           SELECT warranty_type, status, start_date, months, visits, end_date
             FROM device_warranties
            WHERE device_id = d.id
            ORDER BY (status = 'active') DESC, created_at DESC
            LIMIT 1
         ) w ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE status NOT IN ('completed', 'closed', 'cancelled')) AS active_task_count
             FROM open_tasks
            WHERE device_id = d.id
         ) active_work ON TRUE
         LEFT JOIN LATERAL (
           SELECT id, agreement_number, maintenance_plan, visits_count, start_date, end_date
             FROM service_agreements
            WHERE installed_device_id = d.id
              AND status = 'active'
              AND (start_date IS NULL OR start_date <= CURRENT_DATE)
              AND (end_date IS NULL OR end_date >= CURRENT_DATE)
            ORDER BY COALESCE(start_date, agreement_date) DESC, id DESC
            LIMIT 1
         ) active_sa ON TRUE
        WHERE d.id = $1 AND d.customer_id = $2`,
      [deviceId, clientId],
    );

    // Do not confirm that a foreign device id exists.
    if (!rows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
    return res.json(rows[0]);
  } catch (err) {
    return sendAppError(res, err, 'devices.detail');
  }
});

export default router;
