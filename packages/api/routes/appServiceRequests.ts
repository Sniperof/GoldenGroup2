import { Router } from 'express';
import { optionalAppAuth } from '../middleware/appAuth.js';
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

/**
 * Mobile intake gateway. A valid app bearer token identifies a registered
 * customer. With no token, water_check accepts either the migration-period OTP
 * visitor handle or an unverified stable X-Device-Id. Invalid bearer tokens
 * never fall back to a weaker tier.
 *
 * @swagger
 * /api/app/service-requests:
 *   post:
 *     tags: [App - Service Requests]
 *     summary: Submit a water-check request as customer, OTP visitor, or unverified device
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
 *               requestType: { type: string, example: water_check }
 *               formVersion: { type: string, example: water_check.mobile.v3 }
 *               submissionMode: { type: string, enum: [for_self, for_another] }
 *               referrerMode:
 *                 type: string
 *                 enum: [none, requester, separate_person]
 *                 description: Required only for for_another. Registered customers may use none or requester.
 *               handle: { type: string, format: uuid, description: Visitor only }
 *               requesterFirstName: { type: string, description: External for_another requester only }
 *               requesterPhone: { type: string }
 *               requesterPhoneHasWhatsapp: { type: boolean }
 *               referrerFirstName: { type: string, description: Required with separate_person }
 *               referrerLastName: { type: string }
 *               referrerFatherName: { type: string, nullable: true }
 *               referrerPhone: { type: string }
 *               referrerPhoneHasWhatsapp: { type: boolean }
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
    });
    return res.status(201).json(result);
  } catch (err) {
    return sendAppError(res, err, 'serviceRequests.intake');
  }
});

export default router;
