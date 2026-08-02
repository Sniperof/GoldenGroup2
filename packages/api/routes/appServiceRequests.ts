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
 * customer. With no token, the request must carry a one-time visitor OTP
 * handle (purpose=service_request). Invalid bearer tokens never fall back.
 *
 * @swagger
 * /api/app/service-requests:
 *   post:
 *     tags: [App - Service Requests]
 *     summary: Submit a mobile service request as a verified visitor or customer
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
 *             required: [requestType, submissionMode]
 *             properties:
 *               requestType: { type: string, example: water_check }
 *               formVersion: { type: string, example: water_check.mobile.v2 }
 *               submissionMode: { type: string, enum: [for_self, for_another] }
 *               handle: { type: string, format: uuid, description: Visitor only }
 *               referrerFirstName:
 *                 type: string
 *                 description: >
 *                   The sender's own name. Required for a VISITOR sending
 *                   for_another; refused otherwise (a customer's name is
 *                   derived from their record, and for_self has no referrer).
 *               referrerLastName: { type: string }
 *               referrerFatherName: { type: string, nullable: true }
 *     responses:
 *       201: { description: Request created }
 *       400: { description: "Invalid type, mode, or form payload. Named codes: invalid_form_payload (details.issues[]), identity_fields_not_accepted, referrer_fields_not_accepted, missing_referrer_name" }
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
    const result = await executeMobileIntake({
      handler: availability.handler,
      body,
      appAccount: req.appAccount,
    });
    return res.status(201).json(result);
  } catch (err) {
    return sendAppError(res, err, 'serviceRequests.intake');
  }
});

export default router;
