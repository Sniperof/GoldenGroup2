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
 *       500: { description: Registry unavailable }
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
    console.error('Mobile service-request type list error:', err);
    return res.status(500).json({ error: 'service_request_registry_unavailable' });
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
 *               formVersion: { type: string, example: water_check.mobile.v1 }
 *               submissionMode: { type: string, enum: [for_self, for_another] }
 *               handle: { type: string, format: uuid, description: Visitor only }
 *     responses:
 *       201: { description: Request created }
 *       400: { description: Invalid type, form, mode, or payload }
 *       401: { description: Invalid app bearer token }
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
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json({
        error: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    console.error('Mobile service-request intake error:', err);
    return res.status(500).json({ error: 'service_request_intake_failed' });
  }
});

export default router;
