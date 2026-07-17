import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  listAccountRequests,
  getAccountRequestDetails,
  getSuggestions,
  linkAccountRequest,
  rejectAccountRequest,
  escalateAccountRequest,
} from '../services/appAccounts/adminAccountRequestService.js';

const router = Router();
router.use(requireAuth);

function actor(req: Request) {
  return { userId: req.authContext!.userId };
}
function handle(res: Response, err: any, label: string) {
  if (err?.status) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  console.error(`${label} error:`, err);
  return res.status(500).json({ error: err.message });
}

/**
 * @swagger
 * tags:
 *   - name: Admin - Account Requests
 *     description: Web-portal review + decisions for account_creation requests. DEC-013 §2.5.
 */

/**
 * @swagger
 * /api/admin/account-requests:
 *   get:
 *     tags: [Admin - Account Requests]
 *     summary: List account-creation requests
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string } }
 *       - { in: query, name: duplicate, schema: { type: boolean } }
 *       - { in: query, name: search, schema: { type: string }, description: phone / name / ref }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *       - { in: query, name: offset, schema: { type: integer, default: 0 } }
 *     responses:
 *       200: { description: List of requests }
 *       403: { description: Missing account_requests.view }
 */
router.get('/', requirePermission('account_requests.view'), async (req, res) => {
  try {
    const result = await listAccountRequests({
      status: (req.query.status as string) ?? null,
      duplicate: req.query.duplicate === 'true' ? true : null,
      search: (req.query.search as string) ?? null,
      limit: req.query.limit ? parseInt(String(req.query.limit)) : undefined,
      offset: req.query.offset ? parseInt(String(req.query.offset)) : undefined,
    });
    res.json(result);
  } catch (err) {
    handle(res, err, 'List account requests');
  }
});

/**
 * @swagger
 * /api/admin/account-requests/{id}:
 *   get:
 *     tags: [Admin - Account Requests]
 *     summary: Account-creation request details + audit log
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Request + audit }
 *       404: { description: Not found }
 */
router.get('/:id', requirePermission('account_requests.view'), async (req, res) => {
  try {
    res.json(await getAccountRequestDetails(parseInt(String(req.params.id))));
  } catch (err) {
    handle(res, err, 'Account request details');
  }
});

/**
 * @swagger
 * /api/admin/account-requests/{id}/suggestions:
 *   get:
 *     tags: [Admin - Account Requests]
 *     summary: Suggested client records (fuzzy match, clients only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Ranked client suggestions with confidence }
 */
router.get('/:id/suggestions', requirePermission('account_requests.view'), async (req, res) => {
  try {
    res.json(await getSuggestions(parseInt(String(req.params.id))));
  } catch (err) {
    handle(res, err, 'Account request suggestions');
  }
});

/**
 * @swagger
 * /api/admin/account-requests/{id}/link:
 *   post:
 *     tags: [Admin - Account Requests]
 *     summary: Approve — link to a client and activate the app account
 *     description: Creates/activates app_account (status active), links beneficiary, sets request completed. DEC-013 §7.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientId]
 *             properties:
 *               clientId: { type: integer }
 *     responses:
 *       200: { description: Linked + activated }
 *       409: { description: Already processed, or number already has an active account }
 */
router.post('/:id/link', requirePermission('account_requests.link'), async (req, res) => {
  try {
    const result = await linkAccountRequest({
      requestId: parseInt(String(req.params.id)),
      clientId: parseInt(String(req.body?.clientId)),
      actorUserId: actor(req).userId,
      actorRole: 'operator',
    });
    res.json(result);
  } catch (err) {
    handle(res, err, 'Link account request');
  }
});

/**
 * @swagger
 * /api/admin/account-requests/{id}/escalate:
 *   post:
 *     tags: [Admin - Account Requests]
 *     summary: Escalate to the account audit admin
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [reason], properties: { reason: { type: string } } }
 *     responses:
 *       200: { description: Escalated }
 */
router.post('/:id/escalate', requirePermission('account_requests.escalate'), async (req, res) => {
  try {
    res.json(await escalateAccountRequest({
      requestId: parseInt(String(req.params.id)),
      reason: req.body?.reason,
      actorUserId: actor(req).userId,
      actorRole: 'operator',
    }));
  } catch (err) {
    handle(res, err, 'Escalate account request');
  }
});

/**
 * @swagger
 * /api/admin/account-requests/{id}/reject:
 *   post:
 *     tags: [Admin - Account Requests]
 *     summary: Reject the request (account audit admin only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [reasonCode], properties: { reasonCode: { type: string } } }
 *     responses:
 *       200: { description: Rejected }
 *       403: { description: Missing account_requests.reject }
 */
router.post('/:id/reject', requirePermission('account_requests.reject'), async (req, res) => {
  try {
    res.json(await rejectAccountRequest({
      requestId: parseInt(String(req.params.id)),
      reasonCode: req.body?.reasonCode,
      actorUserId: actor(req).userId,
      actorRole: 'audit_admin',
    }));
  } catch (err) {
    handle(res, err, 'Reject account request');
  }
});

export default router;
