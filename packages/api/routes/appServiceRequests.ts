import { Router } from 'express';
import { optionalAppAuth, requireAppAuth } from '../middleware/appAuth.js';
import pool from '../db.js';
import {
  evaluateMobileIntakeAvailability,
  getMobileIntakeHandler,
} from '../services/serviceRequests/mobileIntakeRegistry.js';
import {
  getServiceRequestTypeDefinition,
  listActiveServiceRequestTypeDefinitions,
} from '../services/serviceRequests/serviceRequestTypeRegistry.js';
import { executeMobileIntake } from '../services/serviceRequests/mobileIntakeExecution.js';
import { sendAppError } from '../utils/appErrors.js';
import {
  mobileServiceRequestMediaUpload,
  uploadMobileServiceRequestMedia,
} from './mobileServiceRequestMedia.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: App - Service Requests
 *     description: Runtime-registry-driven mobile service-request intake.
 */

/**
 * @swagger
 * /api/app/service-requests/types:
 *   get:
 *     tags: [App - Service Requests]
 *     summary: List request types currently executable from the mobile app
 *     responses:
 *       200: { description: Executable registry/handler intersection }
 *       429: { description: "Per-IP read window (details.code = rate_limited)" }
 *       503: { description: "Registry unavailable (details.code = service_request_registry_unavailable)" }
 */
router.get('/types', async (_req, res) => {
  try {
    const definitions = await listActiveServiceRequestTypeDefinitions();
    const items = definitions.flatMap((definition) => {
      const handler = getMobileIntakeHandler(definition.requestType);
      if (
        !handler ||
        !definition.channels.includes('mobile_app') ||
        handler.formVersion !== definition.defaultFormVersion ||
        definition.submissionModes.length === 0
      ) return [];
      return [{
        requestType: definition.requestType,
        labelAr: definition.labelAr,
        descriptionAr: definition.descriptionAr,
        formVersion: definition.defaultFormVersion,
        formSource: definition.formSource,
        submitterTiers: definition.submitterTiers,
        submissionModes: definition.submissionModes,
      }];
    });
    return res.json({ items });
  } catch (err) {
    console.error('[app:serviceRequests.types]', err);
    return res.status(503).json({
      error: 'تعذّر تحميل أنواع الطلبات. حاول لاحقاً.',
      details: { code: 'service_request_registry_unavailable' },
    });
  }
});

/** Returns only devices owned by the authenticated app account's client. */
router.get(['/emergency-maintenance/devices', '/periodic-maintenance/devices'], requireAppAuth, async (req, res) => {
  const clientId = req.appAccount!.clientId;
  const { rows } = await pool.query(
    `SELECT d.id,
            d.device_model_id AS "deviceModelId",
            COALESCE(NULLIF(d.device_model_name, ''), dm.name_ar, dm.name, d.external_device_name) AS "deviceName",
            d.serial_number AS "serialNumber",
            d.status,
            d.installation_geo_unit_id AS "installationGeoUnitId",
            gu.name AS "installationGeoUnitName",
            d.installation_address_text AS "installationAddressText",
            d.installation_lat AS "installationLat",
            d.installation_lng AS "installationLng"
       FROM installed_devices d
       LEFT JOIN device_models dm ON dm.id = d.device_model_id
       LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
      WHERE d.customer_id = $1
        AND d.status NOT IN ('returned', 'disposed')
      ORDER BY d.created_at DESC, d.id DESC`,
    [clientId],
  );
  return res.json({ items: rows });
});

/** Eligible installed devices for an authenticated self golden-warranty request. */
router.get('/golden-warranty/devices', requireAppAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id,
            d.device_model_id AS "deviceModelId",
            COALESCE(dm.name_ar, dm.name_en, dm.name) AS "deviceName",
            d.serial_number AS "serialNumber",
            d.status,
            dm.golden_warranty_periods AS "goldenWarrantyPeriods",
            EXISTS (
              SELECT 1 FROM device_warranties w
               WHERE w.device_id = d.id AND w.status = 'active'
            ) AS "hasActiveWarranty",
            EXISTS (
              SELECT 1 FROM open_tasks ot
               WHERE ot.device_id = d.id
                 AND ot.task_type = 'golden_warranty_offer'
                 AND ot.status NOT IN ('completed', 'closed', 'cancelled')
            ) AS "hasActiveGoldenWarrantyOffer"
       FROM installed_devices d
       JOIN device_models dm ON dm.id = d.device_model_id
      WHERE d.customer_id = $1
        AND d.status = 'active'
        AND dm.is_active = TRUE
        AND dm.is_golden_warranty = TRUE
        AND jsonb_typeof(dm.golden_warranty_periods) = 'array'
        AND jsonb_array_length(dm.golden_warranty_periods) > 0
      ORDER BY d.created_at DESC, d.id DESC`,
    [req.appAccount!.clientId],
  );
  return res.json({ items: rows });
});

/** Visitor-safe eligible catalog models; each model carries its own periods. */
router.get('/golden-warranty/models', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id,
            COALESCE(name_ar, name_en, name) AS "deviceName",
            golden_warranty_periods AS "goldenWarrantyPeriods"
       FROM device_models
      WHERE is_active = TRUE
        AND is_golden_warranty = TRUE
        AND jsonb_typeof(golden_warranty_periods) = 'array'
        AND jsonb_array_length(golden_warranty_periods) > 0
      ORDER BY COALESCE(name_ar, name_en, name), id`,
  );
  return res.json({ items: rows });
});

/** Visitor-safe request reasons for the periodic-maintenance form. */
router.get('/periodic-maintenance/options', async (_req, res) => {
  const { rows } = await pool.query<{
    id: number; value: string; display_order: number; metadata: Record<string, unknown> | null;
  }>(
    `SELECT id, value, display_order, metadata
       FROM system_lists
      WHERE category = 'periodic_maintenance_request_reasons'
        AND is_active = TRUE
      ORDER BY display_order, id`,
  );
  return res.json({
    reasons: rows.map((row) => ({
      id: Number(row.id),
      code: String(row.metadata?.code ?? row.value),
      label: row.value,
    })),
  });
});

/** Visitor-safe vocabularies and live limits for the name-nomination form. */
router.get('/name-nomination/options', async (_req, res) => {
  const [{ rows }, settings] = await Promise.all([
    pool.query<{ value: string; display_order: number }>(
      `SELECT value,display_order FROM system_lists
        WHERE category='occupation' AND is_active=TRUE ORDER BY display_order,id`,
    ),
    pool.query<{ key: string; value: string }>(
      `SELECT key,value FROM system_settings WHERE key=ANY($1::text[])`,
      [[
        'name_nomination_max_names_per_request',
        'name_nomination_daily_per_identity',
        'name_nomination_daily_per_unverified_ip',
      ]],
    ),
  ]);
  const setting = new Map(settings.rows.map((row) => [row.key, Number(row.value)]));
  return res.json({
    occupations: rows.map((row) => row.value),
    maxNamesPerRequest: setting.get('name_nomination_max_names_per_request') ?? 50,
    dailyPerIdentity: setting.get('name_nomination_daily_per_identity') ?? 5,
    dailyPerUnverifiedIp: setting.get('name_nomination_daily_per_unverified_ip') ?? 20,
  });
});

/** Visitor-safe, admin-managed vocabularies used by the emergency form. */
router.get('/emergency-maintenance/options', async (_req, res) => {
  const { rows } = await pool.query<{
    category: string;
    value: string;
    display_order: number;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT category, value, display_order, metadata
       FROM system_lists
      WHERE category = ANY($1::text[])
        AND is_active = TRUE
      ORDER BY category, display_order, id`,
    [[
      'emergency_maintenance_safety_indicators',
      'emergency_maintenance_attachment_categories',
    ]],
  );
  const toOption = (row: typeof rows[number]) => ({
    code: String(row.metadata?.code ?? row.value),
    label: row.value,
  });
  return res.json({
    safetyIndicators: rows
      .filter((row) => row.category === 'emergency_maintenance_safety_indicators')
      .map(toOption),
    attachmentCategories: rows
      .filter((row) => row.category === 'emergency_maintenance_attachment_categories')
      .map(toOption),
  });
});

router.post(
  '/media',
  optionalAppAuth,
  mobileServiceRequestMediaUpload,
  uploadMobileServiceRequestMedia,
);

/**
 * Agent-license mobile contract: see docs/api/mobile-agent-license-api-reference.md.
 * The generic gateway below rejects undeclared fields and derives self_only.
 */

/**
 * Mobile intake gateway. A valid app bearer token identifies a registered
 * customer. With no token, enabled request types accept either the migration-period OTP
 * visitor handle or an unverified stable X-Device-Id. Invalid bearer tokens
 * never fall back to a weaker tier.
 *
 * @swagger
 * /api/app/service-requests:
 *   post:
 *     tags: [App - Service Requests]
 *     summary: Submit an enabled service request as customer, OTP visitor, or unverified device
 *     description: >
 *       The body is validated against the DECLARED form of the active version:
 *       undeclared keys are rejected, not dropped, because the submitted payload
 *       is immutable once stored. See
 *       docs/api/mobile-service-requests-api-reference.md for the field table.
 *     security: [{ bearerAuth: [] }, {}]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [requestType, formVersion, submissionMode]
 *             properties:
 *               requestType: { type: string, example: emergency_maintenance }
 *               formVersion: { type: string, example: emergency_maintenance.mobile.v2 }
 *               submissionMode: { type: string, enum: [for_self, for_another] }
 *               referrerMode:
 *                 type: string
 *                 enum: [none, requester, separate_person]
 *                 description: Required only for for_another. Registered customers may use none or requester.
 *               handle: { type: string, format: uuid, description: Visitor only }
 *               firstName: { type: string, description: Beneficiary first name }
 *               fatherName: { type: string, nullable: true, description: Optional beneficiary father name }
 *               lastName: { type: string, description: Beneficiary last name }
 *               phoneNumber: { type: string, description: Beneficiary primary phone }
 *               primaryPhoneHasWhatsapp: { type: boolean }
 *               secondaryPhone: { type: string, nullable: true, description: Optional beneficiary secondary phone }
 *               secondaryPhoneHasWhatsapp: { type: boolean, description: Optional; defaults to false when secondaryPhone is supplied }
 *               requesterFirstName: { type: string, description: External for_another requester; optional with referrerMode none }
 *               requesterFatherName: { type: string, nullable: true }
 *               requesterPhone: { type: string }
 *               requesterPhoneHasWhatsapp: { type: boolean }
 *               requesterSecondaryPhone: { type: string, nullable: true }
 *               requesterSecondaryPhoneHasWhatsapp: { type: boolean, description: Optional; defaults to false when requesterSecondaryPhone is supplied }
 *               referrerFirstName: { type: string, description: Required with separate_person }
 *               referrerLastName: { type: string }
 *               referrerFatherName: { type: string, nullable: true }
 *               referrerPhone: { type: string }
 *               referrerPhoneHasWhatsapp: { type: boolean }
 *               referrerSecondaryPhone: { type: string, nullable: true }
 *               referrerSecondaryPhoneHasWhatsapp: { type: boolean, description: Optional; defaults to false when referrerSecondaryPhone is supplied }
 *               referrerGovernorate: { type: integer, description: Required SmartGeo level 1 whenever a referrer exists }
 *               referrerCityOrArea: { type: integer, description: Required SmartGeo level 2 whenever a referrer exists }
 *               referrerSubArea: { type: integer, description: Required SmartGeo level 3 whenever a referrer exists }
 *               referrerNeighborhood: { type: integer, nullable: true, description: Optional SmartGeo level 4 for the referrer }
 *               referrerDetailedAddress: { type: string, nullable: true, description: Optional detailed referrer address }
 *               referrerMapLocation:
 *                 type: object
 *                 nullable: true
 *                 description: Optional referrer coordinates
 *                 properties:
 *                   lat: { type: number }
 *                   lng: { type: number }
 *               governorate: { type: integer, description: SmartGeo level 1; governorateId is also accepted }
 *               cityOrArea: { type: integer, nullable: true, description: SmartGeo level 2; regionId is also accepted }
 *               subArea: { type: integer, nullable: true, description: SmartGeo level 3; subdistrictId is also accepted }
 *               neighborhood: { type: integer, nullable: true, description: SmartGeo level 4; neighborhoodId is also accepted }
 *     responses:
 *       201: { description: Request created }
 *       400: { description: "Invalid form or party model. See the mobile API reference for named codes." }
 *       401: { description: Invalid app bearer token }
 *       403: { description: Suspended account, or tier not allowed for this type }
 *       404: { description: Unknown request type }
 *       409: { description: "Inactive type, used handle, form-version mismatch, or an open request already exists for this beneficiary phone (open_request_exists, details.publicRefNumber)" }
 *       413: { description: Submitted payload exceeds the stored-size ceiling }
 *       429: { description: "Per-IP window (rate_limited) or the identity's 24h submission quota (daily_request_quota_reached)" }
 *       501: { description: Registry type has no installed handler }
 *       503: { description: Registry and handler versions disagree }
 */
router.post('/', optionalAppAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestType = typeof body.requestType === 'string' ? body.requestType.trim() : '';
    if (!requestType) {
      return res.status(400).json({ error: 'request_type_required' });
    }
    if (
      (requestType === 'emergency_maintenance'
        || requestType === 'device_request'
        || requestType === 'periodic_maintenance'
        || requestType === 'golden_warranty'
        || requestType === 'name_nomination'
        || requestType === 'agent_license')
      && !req.get('Idempotency-Key')
    ) {
      return res.status(400).json({ error: 'idempotency_key_required' });
    }
    const definition = await getServiceRequestTypeDefinition(requestType);
    const availability = evaluateMobileIntakeAvailability({
      definition,
      requestType,
      isAuthenticatedCustomer: !!req.appAccount,
      submittedFormVersion: typeof body.formVersion === 'string' ? body.formVersion : null,
      submittedMode: typeof body.submissionMode === 'string' ? body.submissionMode : null,
    });
    if (availability.ok !== true) {
      return res.status(availability.status).json({
        error: availability.code,
        ...(availability.details ? { details: availability.details } : {}),
      });
    }
    const deviceIdHeader = req.get('X-Device-Id');
    const result = await executeMobileIntake({
      handler: availability.handler,
      body,
      appAccount: req.appAccount,
      deviceId: deviceIdHeader ?? null,
      // `req.ip` is only trustworthy when TRUST_PROXY is set behind nginx —
      // without it every submission looks like 127.0.0.1 and the IP layer
      // collapses into one shared bucket (see the deployment table in the
      // mobile API reference).
      ip: req.ip ?? null,
      idempotencyKey: req.get('Idempotency-Key') ?? null,
    });
    return res.status(201).json(result);
  } catch (err) {
    return sendAppError(res, err, 'serviceRequests.intake');
  }
});

export default router;
