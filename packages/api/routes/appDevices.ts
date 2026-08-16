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
              d.installation_address_text AS "installationAddressText",
              d.delivery_date AS "deliveryDate",
              d.installation_date AS "installationDate",
              w.warranty_type AS "warrantyType",
              w.status AS "warrantyStatus",
              w.end_date AS "warrantyEndDate"
         FROM installed_devices d
         LEFT JOIN device_models dm ON dm.id = d.device_model_id
         LEFT JOIN LATERAL (
           SELECT warranty_type, status, end_date
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

export default router;
