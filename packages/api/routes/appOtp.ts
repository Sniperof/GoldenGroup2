import { Router } from 'express';
import { sendOtp, verifyOtp } from '../services/otp/otpService.js';
import { sendAppError } from '../utils/appErrors.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: App - Auth
 *     description: Customer mobile-app OTP (public, no staff auth). DEC-013 §6.
 */

/**
 * @swagger
 * /api/app/otp/send:
 *   post:
 *     tags: [App - Auth]
 *     summary: Send a one-time password to a mobile number
 *     description: >
 *       Generates an OTP (valid 120s), stores only its hash, and "sends" it via
 *       the configured provider. In dev/simulated mode the code is returned as
 *       `devCode`. A new code is blocked for 60s after the previous one.
 *
 *       The purpose must match the number's real situation, so no SMS is spent
 *       on a journey that cannot succeed: `account_creation` requires no live
 *       account (active or suspended — a suspended account is reactivated,
 *       never replaced) AND no pending request (a reinstalling user with a
 *       pending request must use `request_status` instead),
 *       `login`/`account_deletion` require an active account,
 *       `request_status` requires a pending request, `service_request` is open
 *       to visitors. Route by `GET /api/app/account/status` first and pick the
 *       purpose from it.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, purpose]
 *             properties:
 *               phone:
 *                 type: string
 *                 description: Syrian mobile; normalized server-side.
 *                 example: "0912345678"
 *               purpose:
 *                 type: string
 *                 enum: [account_creation, login, account_deletion, request_status, service_request]
 *     responses:
 *       200:
 *         description: OTP sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sent: { type: boolean, example: true }
 *                 expiresInSeconds: { type: integer, example: 120 }
 *                 resendInSeconds: { type: integer, example: 60 }
 *                 devCode:
 *                   type: string
 *                   description: Present ONLY in dev/simulated mode. Never in production.
 *                   example: "482913"
 *       400: { description: Invalid phone number or purpose }
 *       403: { description: "Account suspended (details.code = suspended)" }
 *       404: { description: "Purpose precondition failed (details.code = no_active_account | no_pending_request)" }
 *       409: { description: "account_creation blocked (details.code = active_account_exists | suspended | pending_request_exists, details.status)" }
 *       429:
 *         description: >
 *           Throttled. Three distinct causes, told apart by details.code:
 *           absent = the 60s resend window has not elapsed (details.retryAfterSeconds);
 *           `daily_cap_reached` = this number exhausted its 24h message cap across ALL
 *           purposes (details.limit); `rate_limited` = the per-IP window for this route
 *           (details.retryAfterSeconds, plus a Retry-After header).
 */
router.post('/send', async (req, res) => {
  try {
    const { phone, purpose } = req.body ?? {};
    const result = await sendOtp({ phone, purpose });
    res.json(result);
  } catch (err) {
    sendAppError(res, err, 'otp.send');
  }
});

/**
 * @swagger
 * /api/app/otp/verify:
 *   post:
 *     tags: [App - Auth]
 *     summary: Verify an OTP and receive a one-time verification handle
 *     description: >
 *       On success returns an opaque one-time `handle` (the pre-account proof)
 *       to attach to the next action (e.g. create the account request). Up to 5
 *       attempts; a wrong code reports `details.attemptsRemaining`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, code, purpose]
 *             properties:
 *               phone: { type: string, example: "0912345678" }
 *               code: { type: string, example: "482913" }
 *               purpose:
 *                 type: string
 *                 enum: [account_creation, login, account_deletion, request_status, service_request]
 *     responses:
 *       200:
 *         description: Verified
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verified: { type: boolean, example: true }
 *                 handle:
 *                   type: string
 *                   format: uuid
 *                   description: One-time proof; attach to the next request.
 *                 purpose: { type: string, example: account_creation }
 *       400: { description: Invalid or expired code (may include details.attemptsRemaining) }
 *       429: { description: Too many attempts — request a new code }
 */
router.post('/verify', async (req, res) => {
  try {
    const { phone, code, purpose } = req.body ?? {};
    const result = await verifyOtp({ phone, code, purpose });
    res.json(result);
  } catch (err) {
    sendAppError(res, err, 'otp.verify');
  }
});

export default router;
