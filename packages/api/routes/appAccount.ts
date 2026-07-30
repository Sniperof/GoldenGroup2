import { Router } from 'express';
import {
  checkMobileStatus,
  createAccountRequest,
  getPendingRequestByVerifiedHandle,
} from '../services/appAccounts/accountRequestService.js';
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
 *
 *       Optional `ref` — the request's publicRefNumber the app stored from the
 *       create response. When it matches the number's rejected non-archived
 *       request, the response adds `rejection {code, label, rejectedAt}` so the
 *       fate + reason surface in the SAME boot call, with no OTP round. The ref
 *       is the capability: phone alone keeps answering a silent `visitor`.
 *       Reason only — never personal data. Archiving the request ends it.
 *     parameters:
 *       - in: query
 *         name: phone
 *         required: true
 *         schema: { type: string, example: "0912345678" }
 *       - in: query
 *         name: ref
 *         required: false
 *         schema: { type: string, example: "SR-20260718-0004" }
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
 *                 rejection:
 *                   type: object
 *                   nullable: true
 *                   description: Only when a valid `ref` matches a rejected request.
 *                   properties:
 *                     code: { type: string, example: duplicate }
 *                     label: { type: string, example: "طلب مكرّر — يوجد طلب أو حساب سابق لهذا الرقم" }
 *                     rejectedAt: { type: string, format: date-time, nullable: true }
 *       400: { description: Missing or invalid phone }
 */
router.get('/account/status', async (req, res) => {
  try {
    const phone = String(req.query.phone ?? '');
    if (!phone) return res.status(400).json({ error: 'رقم الموبايل مطلوب' });
    const result = await checkMobileStatus(phone, typeof req.query.ref === 'string' ? req.query.ref : undefined);
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
 *         description: >
 *           Request created (Pending). Echoes the STORED snapshot — the same shape
 *           as `POST /api/app/account-requests/mine` — so the app renders its
 *           pending screen with no extra call, shows normalized values (phone as
 *           `09XXXXXXXX`, resolved address labels) and needs one renderer for both
 *           paths. Persist it locally.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: pending }
 *                 requestId: { type: integer }
 *                 publicRefNumber: { type: string, example: "SR-20260718-0001" }
 *                 submittedAt: { type: string, format: date-time }
 *                 firstName: { type: string, nullable: true }
 *                 lastName: { type: string, nullable: true }
 *                 primaryMobile: { type: string }
 *                 secondaryMobile: { type: string, nullable: true }
 *                 address:
 *                   type: object
 *                   properties:
 *                     governorate: { type: string, nullable: true }
 *                     cityOrArea: { type: string, nullable: true }
 *                     subArea: { type: string, nullable: true }
 *                     neighborhood: { type: string, nullable: true }
 *                     detailedAddress: { type: string, nullable: true }
 *                 notes: { type: string, nullable: true }
 *                 location: { type: object, nullable: true }
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

/**
 * @swagger
 * /api/app/account-requests/mine:
 *   post:
 *     tags: [App - Account]
 *     summary: Recover the caller's own pending account request
 *     description: >
 *       Returns the request exactly as the customer submitted it (name, phones,
 *       address labels, notes) so the profile screen can be rebuilt after the
 *       app's local copy is lost (reinstall / new device). The payload is
 *       personal data, so it is NOT served by the public phone-keyed
 *       `/account/status` route — ownership of the number must be proven with an
 *       OTP handle of purpose `request_status`, which is consumed here.
 *       After the admin links and activates, this data comes from
 *       `GET /api/app/me` instead (source: client record, values may differ).
 *
 *       If the latest non-archived request was REJECTED, returns the same
 *       snapshot with `status: "rejected"` plus `rejection {code, label,
 *       rejectedAt}` — disclosed only to the proven owner; the public status
 *       route keeps answering `visitor`. Archiving the request closes this
 *       window. A live pending request always wins over an older rejected one.
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
 *       200:
 *         description: The submitted snapshot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, enum: [pending, rejected] }
 *                 rejection:
 *                   type: object
 *                   nullable: true
 *                   description: Present only when status = rejected.
 *                   properties:
 *                     code: { type: string, example: duplicate }
 *                     label: { type: string, example: "طلب مكرّر — يوجد طلب أو حساب سابق لهذا الرقم" }
 *                     rejectedAt: { type: string, format: date-time, nullable: true }
 *                 requestId: { type: integer }
 *                 publicRefNumber: { type: string, example: SR-20260721-0007 }
 *                 submittedAt: { type: string, format: date-time }
 *                 firstName: { type: string, nullable: true }
 *                 lastName: { type: string, nullable: true }
 *                 primaryMobile: { type: string }
 *                 secondaryMobile: { type: string, nullable: true }
 *                 address:
 *                   type: object
 *                   properties:
 *                     governorate: { type: string, nullable: true }
 *                     cityOrArea: { type: string, nullable: true }
 *                     subArea: { type: string, nullable: true }
 *                     neighborhood: { type: string, nullable: true }
 *                     detailedAddress: { type: string, nullable: true }
 *                 notes: { type: string, nullable: true }
 *                 location: { type: object, nullable: true }
 *       400: { description: Invalid handle or phone mismatch }
 *       404: { description: No pending request for this number }
 *       409: { description: Handle already consumed }
 */
router.post('/account-requests/mine', async (req, res) => {
  try {
    const result = await getPendingRequestByVerifiedHandle({
      handle: req.body?.handle,
      phone: req.body?.phone,
    });
    res.json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    console.error('Pending account-request lookup error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
