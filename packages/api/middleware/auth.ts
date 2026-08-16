import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthUser } from '@golden-crm/shared';
import { JWT_SECRET } from '../config/env.js';
import { loadSessionUserFromToken, SessionUserError } from '../services/sessionUserService.js';
import { DEVICE_CLASS_HEADER, classifyDevice } from '../services/deviceClass.js';
import {
  decideWebDeviceAccess,
  loadAllowedTeamSlots,
} from '../services/webDeviceAccessPolicy.js';

export type { AuthUser };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function sendSessionUserError(res: Response, err: unknown): boolean {
  if (!(err instanceof SessionUserError)) {
    return false;
  }

  const status = err.code === 'USER_INACTIVE' ? 403 : 401;
  res.status(status).json({ error: err.message });
  return true;
}

async function loadUserFromAuthorizationHeader(req: Request): Promise<AuthUser> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new SessionUserError('INVALID_TOKEN_USER', 'غير مصرح: يجب تسجيل الدخول أولاً');
  }

  const tokenUser = jwt.verify(authHeader.slice(7), JWT_SECRET) as AuthUser;
  return loadSessionUserFromToken(tokenUser);
}

/**
 * Applies the device policy to an already-resolved session user.
 *
 * Enforced on EVERY request, not only at login: a staff token lives 7 days and
 * travels with the account, not the device, so a session opened on a desktop
 * would otherwise keep working from a phone all week.
 *
 * Returns true when the request was rejected (the response is already sent).
 */
export async function enforceDevicePolicy(
  req: Request,
  res: Response,
  user: AuthUser,
): Promise<boolean> {
  const allowedSlots = await loadAllowedTeamSlots();
  if (allowedSlots.length === 0) return false; // feature off — skip detection

  const { deviceClass } = classifyDevice({
    userAgent: req.headers['user-agent'] ?? null,
    deviceClassHint: (req.headers[DEVICE_CLASS_HEADER] as string | undefined) ?? null,
  });
  const decision = decideWebDeviceAccess({
    deviceClass,
    teamSlotType: user.teamSlotType,
    allowedSlots,
  });
  if (!decision.blocked) return false;

  // A dedicated code, not a bare 401: the web app must show the explanation
  // instead of dropping into a sign-in loop the user cannot escape.
  res.status(403).json({
    error: decision.blocked.message,
    details: { code: decision.blocked.code, deviceClass },
  });
  return true;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  let user: AuthUser;
  try {
    user = await loadUserFromAuthorizationHeader(req);
  } catch (err) {
    if (sendSessionUserError(res, err)) return;
    return res.status(401).json({ error: 'غير مصرح: رمز التحقق غير صالح أو منتهي الصلاحية' });
  }
  if (await enforceDevicePolicy(req, res, user)) return;
  req.user = user;
  return next();
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Legacy guard kept for untouched routes; no new callers should be added.
    if (!req.user) {
      try {
        req.user = await loadUserFromAuthorizationHeader(req);
      } catch (err) {
        if (sendSessionUserError(res, err)) return;
        return res.status(401).json({ error: 'غير مصرح: رمز التحقق غير صالح أو منتهي الصلاحية' });
      }
    }

    if (req.user.isSuperAdmin !== true && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'غير مسموح: صلاحياتك لا تسمح بهذا الإجراء' });
    }

    return next();
  };
}

export { JWT_SECRET };
