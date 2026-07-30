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
  claimAccountRequest,
  transitionAccountRequest,
  addAccountRequestNote,
  resolveAccountRequestEscalation,
  setAccountRequestArchived,
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
      reviewRequired: req.query.reviewRequired === 'true' ? true : null,
      escalatedOnly: req.query.escalatedOnly === 'true' ? true : null,
      staleOnly: req.query.staleOnly === 'true' ? true : null,
      mineUserId: req.query.mine === 'true' ? req.authContext!.userId : null,
      archived: (req.query.archived as string) ?? null,
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
router.get('/:id/suggestions', requirePermission('account_requests.review'), async (req, res) => {
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
router.post('/:id/link', requirePermission('account_requests.decide'), async (req, res) => {
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
router.post('/:id/escalate', requirePermission('account_requests.review'), async (req, res) => {
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

router.post('/:id/resolve-escalation', requirePermission('account_requests.resolve_escalation'), async (req, res) => {
  try {
    res.json(await resolveAccountRequestEscalation({
      requestId: parseInt(String(req.params.id)),
      actorUserId: actor(req).userId,
      actorRole: 'audit_admin',
      note: req.body?.note ?? null,
    }));
  } catch (err) {
    handle(res, err, 'Resolve account request escalation');
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
 *       403: { description: Missing account_requests.decide }
 */
router.post('/:id/reject', requirePermission('account_requests.decide'), async (req, res) => {
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

// ------------------------------------------------------------
// Shared-lifecycle endpoints (parity with water_check), guarded by the
// independent account_requests.* keys per the standard family semantics
// (request-section-contract.md §4/§5): workflow actions → .review,
// terminal decisions (link-approve / reject / reopen) → .decide.
// ------------------------------------------------------------

/**
 * @swagger
 * /api/admin/account-requests/{id}/claim:
 *   post:
 *     tags: [Admin - Account Requests]
 *     summary: Claim the request (received → in_review) — required before linking
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Claimed }
 */
router.post('/:id/claim', requirePermission('account_requests.review'), async (req, res) => {
  try {
    res.json(await claimAccountRequest({
      requestId: parseInt(String(req.params.id)),
      operatorUserId: actor(req).userId,
      actorRole: 'operator',
    }));
  } catch (err) {
    handle(res, err, 'Claim account request');
  }
});

/**
 * @swagger
 * /api/admin/account-requests/{id}/take-over:
 *   post:
 *     tags: [Admin - Account Requests]
 *     summary: Take over ownership from another operator
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { transferReason: { type: string } } }
 *     responses:
 *       200: { description: Ownership transferred }
 */
router.post('/:id/take-over', requirePermission('account_requests.review'), async (req, res) => {
  try {
    res.json(await claimAccountRequest({
      requestId: parseInt(String(req.params.id)),
      operatorUserId: actor(req).userId,
      actorRole: 'operator',
      transferReason: req.body?.transferReason ?? null,
    }));
  } catch (err) {
    handle(res, err, 'Take over account request');
  }
});

// «طلب معلومات من الزبون» dropped (request-section-contract.md §3):
// request-info / resume-review endpoints removed; the customer is contacted
// during in_review and the attempts are documented as internal notes.

/**
 * @swagger
 * /api/admin/account-requests/{id}/reopen:
 *   post:
 *     tags: [Admin - Account Requests]
 *     summary: Reopen a terminal request (→ in_review). Requires a structured reason.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [reopenReason], properties: { reopenReason: { type: string } } }
 *     responses:
 *       200: { description: Reopened }
 */
router.post('/:id/reopen', requirePermission('account_requests.decide'), async (req, res) => {
  try {
    res.json(await transitionAccountRequest({
      requestId: parseInt(String(req.params.id)),
      toStatus: 'in_review',
      actorUserId: actor(req).userId,
      actorRole: 'operator',
      reopenReason: req.body?.reopenReason ?? null,
    }));
  } catch (err) {
    handle(res, err, 'Reopen account request');
  }
});

/**
 * @swagger
 * /api/admin/account-requests/{id}/notes:
 *   post:
 *     tags: [Admin - Account Requests]
 *     summary: Add an internal note (audit only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [note], properties: { note: { type: string } } }
 *     responses:
 *       201: { description: Note added }
 */
router.post('/:id/notes', requirePermission('account_requests.review'), async (req, res) => {
  try {
    await addAccountRequestNote({
      requestId: parseInt(String(req.params.id)),
      note: req.body?.note,
      actorUserId: actor(req).userId,
      actorRole: 'operator',
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    handle(res, err, 'Add account request note');
  }
});

router.post('/:id/archive', requirePermission('account_requests.archive'), async (req, res) => {
  try {
    res.json(await setAccountRequestArchived({
      requestId: parseInt(String(req.params.id)),
      archived: true,
      actorUserId: actor(req).userId,
      actorRole: 'audit_admin',
    }));
  } catch (err) {
    handle(res, err, 'Archive account request');
  }
});

router.post('/:id/unarchive', requirePermission('account_requests.archive'), async (req, res) => {
  try {
    res.json(await setAccountRequestArchived({
      requestId: parseInt(String(req.params.id)),
      archived: false,
      actorUserId: actor(req).userId,
      actorRole: 'audit_admin',
    }));
  } catch (err) {
    handle(res, err, 'Unarchive account request');
  }
});

export default router;
