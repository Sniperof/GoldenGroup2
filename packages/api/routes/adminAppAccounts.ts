import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  getAppAccountForClient,
  directCreateAppAccount,
  bulkActivateAppAccounts,
  suspendAppAccount,
  reactivateAppAccount,
} from '../services/appAccounts/adminAppAccountService.js';

const router = Router();
router.use(requireAuth);

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
 *   - name: Admin - App Accounts
 *     description: Admin proactive onboarding — direct + bulk activation. DEC-013 §2.5.10.
 */

/**
 * @swagger
 * /api/admin/clients/{id}/app-account:
 *   post:
 *     tags: [Admin - App Accounts]
 *     summary: Directly create + activate an app account for a client
 *     description: >
 *       Audit-admin only. Uses the client's primary mobile as the login
 *       identifier, enforces the active-account uniqueness rule, and sets
 *       `created_source='admin'`. No account-creation request involved.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer }, description: clients.id }
 *     responses:
 *       200: { description: Account created + activated }
 *       400: { description: Client mobile invalid }
 *       404: { description: Client not found or deleted }
 *       409: { description: Mobile already has an active account }
 */
/**
 * @swagger
 * /api/admin/clients/{id}/app-account:
 *   get:
 *     tags: [Admin - App Accounts]
 *     summary: Get the app account linked to a client (or null)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ account: {...} | null }" }
 */
router.get('/clients/:id/app-account', requirePermission('app_accounts.view'), async (req, res) => {
  try {
    res.json(await getAppAccountForClient(parseInt(String(req.params.id))));
  } catch (err) {
    handle(res, err, 'Get client app account');
  }
});

router.post('/clients/:id/app-account', requirePermission('app_accounts.create_direct'), async (req, res) => {
  try {
    const result = await directCreateAppAccount({
      clientId: parseInt(String(req.params.id)),
      actorUserId: req.authContext!.userId,
    });
    res.json(result);
  } catch (err) {
    handle(res, err, 'Direct create app account');
  }
});

/**
 * @swagger
 * /api/admin/app-accounts/bulk-activate:
 *   post:
 *     tags: [Admin - App Accounts]
 *     summary: Bulk-activate app accounts for existing clients
 *     description: >
 *       Audit-admin only. Two inputs: a scoped filter, or an explicit id list.
 *       Partial-success — conflicts (already-active) and invalid mobiles are
 *       skipped and reported, not fatal. `created_source='admin_bulk'`.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mode]
 *             properties:
 *               mode: { type: string, enum: [filter, ids] }
 *               filter:
 *                 type: object
 *                 nullable: true
 *                 properties:
 *                   branchId: { type: integer, nullable: true }
 *                   classification: { type: string, nullable: true, description: matches clients.candidate_status }
 *               clientIds:
 *                 type: array
 *                 items: { type: integer }
 *                 description: Required when mode=ids
 *     responses:
 *       200:
 *         description: Report (created / skipped conflict / skipped invalid / missing)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 considered: { type: integer }
 *                 createdCount: { type: integer }
 *                 skippedConflictCount: { type: integer }
 *                 skippedInvalidCount: { type: integer }
 *                 skippedMissingCount: { type: integer }
 *                 truncated: { type: boolean }
 *       400: { description: Bad mode or missing id list }
 */
router.post('/app-accounts/bulk-activate', requirePermission('app_accounts.bulk_activate'), async (req, res) => {
  try {
    const { mode, filter, clientIds } = req.body ?? {};
    const result = await bulkActivateAppAccounts({
      mode,
      filter: filter ?? null,
      clientIds: clientIds ?? null,
      actorUserId: req.authContext!.userId,
    });
    res.json(result);
  } catch (err) {
    handle(res, err, 'Bulk activate app accounts');
  }
});

/**
 * @swagger
 * /api/admin/app-accounts/{id}/suspend:
 *   post:
 *     tags: [Admin - App Accounts]
 *     summary: Suspend an app account (audit admin)
 *     description: Sets status suspended and revokes all refresh tokens immediately.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [reason], properties: { reason: { type: string } } }
 *     responses:
 *       200: { description: Suspended }
 *       409: { description: Account not active }
 */
router.post('/app-accounts/:id/suspend', requirePermission('app_accounts.suspend'), async (req, res) => {
  try {
    res.json(await suspendAppAccount({
      accountId: parseInt(String(req.params.id)),
      reason: req.body?.reason,
      actorUserId: req.authContext!.userId,
    }));
  } catch (err) {
    handle(res, err, 'Suspend app account');
  }
});

/**
 * @swagger
 * /api/admin/app-accounts/{id}/reactivate:
 *   post:
 *     tags: [Admin - App Accounts]
 *     summary: Reactivate a suspended app account (audit admin)
 *     description: Sets status active. Old sessions stay revoked — the customer logs in fresh.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Reactivated }
 *       409: { description: Account not suspended, or number now used by another active account }
 */
router.post('/app-accounts/:id/reactivate', requirePermission('app_accounts.reactivate'), async (req, res) => {
  try {
    res.json(await reactivateAppAccount({
      accountId: parseInt(String(req.params.id)),
      actorUserId: req.authContext!.userId,
    }));
  } catch (err) {
    handle(res, err, 'Reactivate app account');
  }
});

export default router;
