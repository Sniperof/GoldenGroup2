import { Router } from 'express';
import { requireAppAuth } from '../middleware/appAuth.js';
import { exchangeLoginHandle, refreshTokens, logout } from '../services/appAccounts/appAuthService.js';
import { getMyProfile } from '../services/appAccounts/appProfileService.js';
import { sendAppError } from '../utils/appErrors.js';

const router = Router();

function fail(res: any, err: unknown, label: string) {
  return sendAppError(res, err, label);
}

/**
 * @swagger
 * /api/app/auth/login:
 *   post:
 *     tags: [App - Auth]
 *     summary: Log in — exchange a verified login handle for tokens
 *     description: >
 *       For an ACTIVE account: pass the `handle` from OTP verify (purpose=login)
 *       to receive a short access token + a long rotating refresh token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [handle]
 *             properties:
 *               handle: { type: string, format: uuid }
 *               deviceLabel: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Tokens issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken: { type: string }
 *                 refreshToken: { type: string }
 *                 tokenType: { type: string, example: Bearer }
 *                 expiresIn: { type: integer, example: 3600 }
 *                 account: { type: object }
 *       404: { description: No active account for this number }
 */
router.post('/auth/login', async (req, res) => {
  try {
    res.json(await exchangeLoginHandle(req.body?.handle, req.body?.deviceLabel));
  } catch (err) {
    fail(res, err, 'App login');
  }
});

/**
 * @swagger
 * /api/app/auth/refresh:
 *   post:
 *     tags: [App - Auth]
 *     summary: Rotate tokens using a refresh token
 *     description: Issues a new access + refresh (rotation). Reuse of a revoked token revokes the whole family.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [refreshToken], properties: { refreshToken: { type: string } } }
 *     responses:
 *       200: { description: New tokens }
 *       401: { description: Invalid/expired/reused refresh token }
 *       403: { description: Account suspended }
 */
router.post('/auth/refresh', async (req, res) => {
  try {
    res.json(await refreshTokens(req.body?.refreshToken));
  } catch (err) {
    fail(res, err, 'App refresh');
  }
});

/**
 * @swagger
 * /api/app/auth/logout:
 *   post:
 *     tags: [App - Auth]
 *     summary: Log out — revoke the refresh-token family
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [refreshToken], properties: { refreshToken: { type: string } } }
 *     responses:
 *       200: { description: Logged out (idempotent) }
 */
router.post('/auth/logout', async (req, res) => {
  try {
    res.json(await logout(req.body?.refreshToken));
  } catch (err) {
    fail(res, err, 'App logout');
  }
});

/**
 * @swagger
 * /api/app/session:
 *   get:
 *     tags: [App - Auth]
 *     summary: Bootstrap the session at app open
 *     description: >
 *       Validates the access token AND re-reads account status (catches a
 *       suspend). 401 → the app should refresh; 403 suspended → drop to visitor.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Active session + profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: active }
 *                 account: { type: object }
 *       401: { description: Missing/invalid/expired access token }
 *       403: { description: Account suspended }
 */
router.get('/session', requireAppAuth, async (req, res) => {
  res.json({ status: 'active', account: req.appAccount });
});

/**
 * @swagger
 * /api/app/me:
 *   get:
 *     tags: [App - Account]
 *     summary: The logged-in customer's own profile
 *     description: >
 *       Resolves the linked client record and returns a data-minimized profile
 *       (name, mobiles, address, classification, account status). Internal CRM
 *       fields are never exposed.
 *
 *       The address is returned twice: `address` as display names and
 *       `addressIds` as geo_units ids for the same four levels, so a cascading
 *       picker can preselect itself. The client record stores only three geo
 *       columns and may leave gaps in them; both shapes are reconstructed by
 *       walking `geo_units.parent_id` up from the deepest stored unit, so the
 *       chain is always contiguous and always accepted by the request form.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 appAccountId: { type: integer }
 *                 accountStatus: { type: string, example: active }
 *                 memberSince: { type: string, format: date-time }
 *                 firstName: { type: string, nullable: true }
 *                 lastName: { type: string, nullable: true }
 *                 primaryMobile: { type: string }
 *                 secondaryMobiles: { type: array, items: { type: string } }
 *                 classification: { type: string, enum: [OP, FOP, Lead], description: "OP/FOP are promotions; everything else defaults to Lead. Never null." }
 *                 address:
 *                   type: object
 *                   description: Display names.
 *                   properties:
 *                     governorate: { type: string, nullable: true }
 *                     cityOrArea: { type: string, nullable: true }
 *                     subArea: { type: string, nullable: true }
 *                     neighborhood: { type: string, nullable: true }
 *                     detailedAddress: { type: string, nullable: true }
 *                 addressIds:
 *                   type: object
 *                   description: >
 *                     The same levels as geo_units ids — pass these to the
 *                     request form as governorateId / regionId /
 *                     subdistrictId / neighborhoodId.
 *                   properties:
 *                     governorate: { type: integer, nullable: true }
 *                     cityOrArea: { type: integer, nullable: true }
 *                     subArea: { type: integer, nullable: true }
 *                     neighborhood: { type: integer, nullable: true }
 *                 geoUnitId:
 *                   type: integer
 *                   nullable: true
 *                   description: Deepest level present.
 *       401: { description: Missing/invalid/expired access token }
 *       403: { description: Account suspended }
 *       404: { description: Account or client record not found }
 */
router.get('/me', requireAppAuth, async (req, res) => {
  try {
    res.json(await getMyProfile(req.appAccount!));
  } catch (err) {
    fail(res, err, 'App profile');
  }
});

export default router;
