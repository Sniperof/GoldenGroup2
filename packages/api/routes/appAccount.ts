import { Router } from 'express';
import { checkMobileStatus, createAccountRequest } from '../services/appAccounts/accountRequestService.js';
import { deleteAccountByVerifiedHandle } from '../services/appAccounts/accountDeletionService.js';
import { requireAppAuth } from '../middleware/appAuth.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: App - Account
 *     description: Customer mobile-app account creation (public). DEC-013 §2.4.
 */

/**
 * @swagger
 * /api/app/account/status:
 *   get:
 *     tags: [App - Account]
 *     summary: Derived mobile view for a phone number
 *     description: >
 *       Returns the single computed mode the app should render, keyed by the
 *       (normalized) phone: `visitor`, `pending`, `active`, or `suspended`.
 *       The app never sees internal request/account states.
 *     parameters:
 *       - in: query
 *         name: phone
 *         required: true
 *         schema: { type: string, example: "0912345678" }
 *     responses:
 *       200:
 *         description: Derived status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [visitor, pending, active, suspended]
 *       400: { description: Missing or invalid phone }
 */
router.get('/account/status', async (req, res) => {
  try {
    const phone = String(req.query.phone ?? '');
    if (!phone) return res.status(400).json({ error: 'رقم الموبايل مطلوب' });
    const result = await checkMobileStatus(phone);
    res.json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    console.error('Account status error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/app/account-requests:
 *   post:
 *     tags: [App - Account]
 *     summary: Submit an account-creation request (visitor)
 *     description: >
 *       Consumes the one-time verification `handle` from OTP verify, enforces
 *       phone uniqueness (no active account) and the one-pending-per-number
 *       rule, then stores the request as Pending. Admin links it to a client
 *       record later. The account is NOT created here.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [handle, form]
 *             properties:
 *               handle: { type: string, format: uuid, description: From OTP verify (purpose account_creation) }
 *               form:
 *                 type: object
 *                 required: [firstName, lastName, primaryMobile, governorate, detailedAddress]
 *                 properties:
 *                   firstName: { type: string }
 *                   lastName: { type: string }
 *                   primaryMobile: { type: string, example: "0912345678" }
 *                   secondaryMobile: { type: string, nullable: true }
 *                   governorate: { oneOf: [{ type: integer }, { type: string }] }
 *                   cityOrArea: { nullable: true }
 *                   subArea: { nullable: true }
 *                   neighborhood: { nullable: true }
 *                   detailedAddress: { type: string }
 *                   notes: { type: string, nullable: true }
 *                   location:
 *                     type: object
 *                     nullable: true
 *                     properties:
 *                       lat: { type: number }
 *                       lng: { type: number }
 *     responses:
 *       200:
 *         description: Request created (Pending)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: pending }
 *                 requestId: { type: integer }
 *                 publicRefNumber: { type: string, example: "SR-20260718-0001" }
 *       400: { description: Invalid handle, mismatched phone, or missing fields }
 *       409: { description: Active account or a pending request already exists (see details.status) }
 */
router.post('/account-requests', async (req, res) => {
  try {
    const { handle, form } = req.body ?? {};
    const result = await createAccountRequest({ handle, form });
    res.json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    console.error('Account request error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/app/account/delete:
 *   post:
 *     tags: [App - Account]
 *     summary: Delete my account (in-app, Google Play)
 *     description: >
 *       Soft-deletes the app account (login access) and revokes all tokens.
 *       The linked client business record is retained (disclosed). Requires an
 *       OTP re-verification handle (purpose=account_deletion) for this number.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [handle], properties: { handle: { type: string, format: uuid } } }
 *     responses:
 *       200: { description: Account deleted }
 *       400: { description: Invalid handle or phone mismatch }
 *       404: { description: No account for this number }
 */
router.post('/account/delete', requireAppAuth, async (req, res) => {
  try {
    const result = await deleteAccountByVerifiedHandle({
      handle: req.body?.handle,
      source: 'app',
      expectedPhone: req.appAccount!.phone,
    });
    res.json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    console.error('Account delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/app/account/deletion-request:
 *   post:
 *     tags: [App - Account]
 *     summary: Delete an account from the public web page (Google Play)
 *     description: >
 *       Unauthenticated deletion path (does not require the app). Gated by an
 *       OTP handle (purpose=account_deletion) that must match the given phone.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, handle]
 *             properties:
 *               phone: { type: string, example: "0912345678" }
 *               handle: { type: string, format: uuid }
 *     responses:
 *       200: { description: Account deleted }
 *       400: { description: Invalid handle or phone mismatch }
 *       404: { description: No account for this number }
 */
router.post('/account/deletion-request', async (req, res) => {
  try {
    const result = await deleteAccountByVerifiedHandle({
      handle: req.body?.handle,
      source: 'web',
      expectedPhone: req.body?.phone,
    });
    res.json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    console.error('Account deletion-request error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
