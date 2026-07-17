import { Router } from 'express';
import { checkMobileStatus, createAccountRequest } from '../services/appAccounts/accountRequestService.js';

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

export default router;
